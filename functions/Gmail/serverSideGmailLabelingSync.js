'use strict'

const admin = require('firebase-admin')
const crypto = require('crypto')
const { google } = require('googleapis')
const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const {
    CONNECTION_SERVICE_EMAIL,
    findConnectionsForProject,
    getConnection,
    resolveEmailConnection,
} = require('../Integrations/providerConnections')
const {
    addBaseInstructions,
    calculateTokens,
    calculateGoldCostFromTokens,
    collectAssistantTextWithToolCalls,
    getAssistantForChat,
    interactWithChatStream,
    parseTextForUseLiKePrompt,
} = require('../Assistant/assistantHelper')
const { getDefaultAssistantData, GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')
const { deductGold, refundGold } = require('../Gold/goldHelper')
const {
    GMAIL_LABELING_CONFIG_TYPE,
    GMAIL_LABELING_LOCK_TIMEOUT_MS,
    GMAIL_DIRECTION_SCOPE_BOTH,
    GMAIL_DIRECTION_SCOPE_INCOMING,
    GMAIL_DIRECTION_SCOPE_OUTGOING,
    DEFAULT_SYNC_INTERVAL_MINUTES,
    DEFAULT_GMAIL_LABELING_MODEL,
    buildConfigWriteData,
    buildDefaultState,
    getDefaultGmailLabelingConfig,
    getGmailLabelingConfigRef,
    getGmailLabelingStateRef,
    GMAIL_LABELING_PROMPT_MODE_CUSTOM,
    GMAIL_LABELING_PROMPT_MODE_DEFAULT,
    findLabelIdByName,
    normalizePromptMode,
    slugifyLabelKey,
} = require('./gmailLabelingConfig')
const {
    extractEmailAddresses,
    getGmailMessageDirection,
    normalizeGmailMessage,
    parseEmailHeaderAddresses,
} = require('./gmailMessageParser')
const { classifyGmailMessage } = require('./gmailPromptClassifier')
const { addProjectRoutingReasonComment } = require('../shared/projectRoutingCommentHelper')

const MAX_HISTORY_PAGES = 5
const MAX_MESSAGES_FETCH_MULTIPLIER = 3
const ALDDONE_MANAGED_LABEL_PREFIX = 'Alldone/'
// Minimum Gold a user must hold before we'll invoke the classifier LLM. The
// actual billed cost is computed from the classifier's token usage AFTER the
// call and deducted in a single ledger entry; see processSingleMessage for the
// full flow. This constant is also used as the minimum charge when real token
// cost rounds to 0 Gold, so every labeled email is reflected in the log.
const GMAIL_LABELING_MIN_GOLD_TO_CLASSIFY = 1

// Single source of truth for the Ads decision boundary — used verbatim as the Ads
// label description AND embedded in the default-mode prompt so the two cannot drift.
// Mirrored in components/.../GmailLabelingSettings.helpers.js for the client preview.
const DEFAULT_ADS_LABEL_GUIDANCE =
    'Use Ads for promotional, marketing, sales, spam, or unsolicited commercial email, including personalized cold sales outreach. ' +
    'A recurring newsletter the user intentionally subscribed to (editorial or digest content) is not Ads; a one-off promotion, discount, or product pitch is Ads, even from a familiar sender. ' +
    'Never use Ads for transactional email such as receipts, invoices, order or shipping confirmations, or account, billing, and security notifications. ' +
    'An email that is a reply in an existing conversation (inReplyTo or references is set) is never Ads. ' +
    "Gmail's CATEGORY_PROMOTIONS label id and a List-Unsubscribe header are strong Ads signals. " +
    'If an email matches both a project label and Ads, prefer the project label unless the email is pure bulk marketing.'
const DEFAULT_ACTIVE_PROJECTS_PROMPT =
    'Classify each Gmail message into exactly one configured label when it clearly belongs to an active Alldone project or the Ads label. Use the label descriptions as the primary basis for deciding. Prefer precision over recall: if the email could belong to multiple project labels, pick the strongest clear match only when the evidence is specific; otherwise return no match. Consider participants, project names, client names, sender domains, subjects, deadlines, action requests, decisions, deliverables, business context, and project-specific Alldone links. ' +
    DEFAULT_ADS_LABEL_GUIDANCE +
    ' Use the configured confidence threshold: only return a match when the best label is at or above that threshold. Confidence for a match means confidence in the selected label; confidence for no match means confidence that no configured label matches. Do not return no match when your reasoning identifies a configured project, client, sender domain, project-specific link, or clear Ads email; return the matching configured label instead.'
const DEFAULT_PROJECT_FOLLOW_UP_DIRECTION_SCOPE = GMAIL_DIRECTION_SCOPE_INCOMING
const DEFAULT_ADS_LABEL_DEFINITION = {
    key: 'ads',
    gmailLabelName: 'Ads',
    description: DEFAULT_ADS_LABEL_GUIDANCE,
    directionScope: GMAIL_DIRECTION_SCOPE_INCOMING,
    autoArchive: false,
    postLabelPrompt: '',
}

class GmailSyncLockedError extends Error {
    constructor(message) {
        super(message)
        this.name = 'GmailSyncLockedError'
        this.code = 'gmail-sync-locked'
    }
}

function getMessagesAuditCollectionRef(userId, projectId) {
    return getGmailLabelingStateRef(userId, projectId).collection('messages')
}

function chunkArray(items, chunkSize) {
    const chunks = []
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }
    return chunks
}

function createSyncLogContext(userId, projectId, gmailEmail = '') {
    return {
        runId: `${projectId}-${Date.now()}`,
        userId,
        projectId,
        gmailEmail,
    }
}

function normalizeTimestampToMillis(value) {
    if (!value) return 0
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (typeof value?.toDate === 'function') return value.toDate().getTime()
    if (typeof value?.seconds === 'number') return value.seconds * 1000
    if (typeof value?._seconds === 'number') return value._seconds * 1000
    if (typeof value === 'number') return value

    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function getConfiguredSyncIntervalMinutes(config = {}) {
    const parsedInterval = Number(config?.syncIntervalMinutes)
    if (!Number.isFinite(parsedInterval)) return DEFAULT_SYNC_INTERVAL_MINUTES
    return Math.max(DEFAULT_SYNC_INTERVAL_MINUTES, Math.trunc(parsedInterval))
}

function isScheduledSyncDue(state = {}, config = {}) {
    const intervalMinutes = getConfiguredSyncIntervalMinutes(config)
    const lastSyncMillis = normalizeTimestampToMillis(state?.lastSyncAt || state?.lastSuccessfulSyncAt)
    if (!lastSyncMillis) return true
    return Date.now() - lastSyncMillis >= intervalMinutes * 60 * 1000
}

function logSync(message, context = {}) {
    console.log('[gmailLabeling]', message, context)
}

function buildGmailMessageUrl(gmailEmail = '', messageId = '') {
    if (!messageId) return ''
    const normalizedEmail = typeof gmailEmail === 'string' ? gmailEmail.trim().toLowerCase() : ''
    const authQuery = normalizedEmail ? `?authuser=${encodeURIComponent(normalizedEmail)}` : ''
    return `https://mail.google.com/mail/u/0/${authQuery}#all/${encodeURIComponent(messageId)}`
}

function createPostLabelPromptHash(ruleKey = '', prompt = '') {
    return crypto.createHash('sha1').update(`${ruleKey}:${prompt}`).digest('hex')
}

async function getGmailClient(userId, projectId) {
    const accessToken = await getAccessToken(userId, projectId, 'gmail')
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
}

function buildBootstrapQuery(config) {
    return `newer_than:${config.lookbackDays || 7}d`
}

const GMAIL_LABELING_LEGACY_GPT5_MODELS = new Set([
    'MODEL_GPT5',
    'MODEL_GPT5_1',
    'MODEL_GPT5_2',
    'MODEL_GPT5_4',
    'MODEL_GPT5_5',
    'MODEL_GPT5_4_MINI',
])

function applyGmailLabelingModelMigration(config = {}) {
    if (!config || typeof config !== 'object') return config
    const migratedConfig = {
        ...config,
        promptMode: normalizePromptMode(config.promptMode, GMAIL_LABELING_PROMPT_MODE_CUSTOM),
    }

    if (migratedConfig.model && !GMAIL_LABELING_LEGACY_GPT5_MODELS.has(migratedConfig.model)) {
        return migratedConfig
    }

    return {
        ...migratedConfig,
        model: DEFAULT_GMAIL_LABELING_MODEL,
    }
}

function getActiveProjectIdsFromUserData(userData = {}) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    const archivedProjectIds = Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : []
    const templateProjectIds = Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : []
    const guideProjectIds = Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : []
    const blockedProjectIds = new Set([...archivedProjectIds, ...templateProjectIds, ...guideProjectIds])

    return projectIds.filter(
        projectId => typeof projectId === 'string' && projectId.trim() && !blockedProjectIds.has(projectId)
    )
}

function normalizeProjectLabelName(project = {}, index = 0) {
    const labelName = typeof project.name === 'string' ? project.name.trim() : ''
    return labelName || `Untitled project ${index + 1}`
}

function getUniqueProjectLabelNames(projects = []) {
    const counts = new Map()
    return projects.map((project, index) => {
        const baseName = normalizeProjectLabelName(project, index)
        const lookup = baseName.toLowerCase()
        const nextCount = (counts.get(lookup) || 0) + 1
        counts.set(lookup, nextCount)
        return nextCount === 1 ? baseName : `${baseName} (${nextCount})`
    })
}

function buildDefaultProjectLabelDescription(project = {}, labelName = '') {
    const projectName = typeof project.name === 'string' && project.name.trim() ? project.name.trim() : labelName
    const description =
        typeof project.description === 'string'
            ? project.description
                  .trim()
                  .replace(/^project description\s*:\s*/i, '')
                  .trim()
            : ''

    if (description) {
        return `Use this label for emails related to the Alldone project "${projectName}". ${description}. Match messages about this project's work, stakeholders, goals, deadlines, tasks, decisions, updates, or deliverables.`
    }

    return `Use this label for emails clearly related to the Alldone project "${projectName}". Match direct references to the project, its work, stakeholders, tasks, deadlines, decisions, updates, or deliverables.`
}

function buildDefaultProjectFollowUpPrompt(labelName = '') {
    const projectLabel = labelName || 'the matched project'
    return [
        `Only if its an inbound email create a new task based in the project ${projectLabel} based on this email in the following format: "[one sentence summary of what the email is about] ".`,
        `If the email is from a real person (e.g. not notification from google calendar or something like hello@cal.com) also use update_note with the project ${projectLabel} to update the contact note and include a link to the email with a space at the end.`,
    ].join('\n')
}

function buildDefaultActiveProjectLabelDefinitions(projects = []) {
    const labelNames = getUniqueProjectLabelNames(projects)

    const projectLabels = projects.map((project, index) => {
        const gmailLabelName = labelNames[index]
        const projectKey = slugifyLabelKey(project.id || gmailLabelName) || `project_${index + 1}`
        return {
            key: `project_${projectKey}`,
            gmailLabelName,
            description: buildDefaultProjectLabelDescription(project, gmailLabelName),
            directionScope: GMAIL_DIRECTION_SCOPE_BOTH,
            autoArchive: false,
            postLabelPrompt: buildDefaultProjectFollowUpPrompt(gmailLabelName),
            postLabelPromptDirectionScope: DEFAULT_PROJECT_FOLLOW_UP_DIRECTION_SCOPE,
            sourceProjectId: project.id || '',
        }
    })

    return [...projectLabels, { ...DEFAULT_ADS_LABEL_DEFINITION }]
}

async function loadActiveProjectsForDefaultLabels(userData = {}) {
    const activeProjectIds = getActiveProjectIdsFromUserData(userData)
    if (activeProjectIds.length === 0) return []

    const projectDocs = await Promise.all(
        activeProjectIds.map(projectId =>
            admin
                .firestore()
                .collection('projects')
                .doc(projectId)
                .get()
                .catch(error => {
                    console.warn('[gmailLabeling] Failed loading active project for default labels', {
                        projectId,
                        error: error.message,
                    })
                    return null
                })
        )
    )

    return projectDocs
        .map(doc => {
            if (!doc?.exists) return null
            const data = doc.data() || {}
            if (data.active === false || data.isTemplate === true || data.parentTemplateId) return null
            return {
                id: doc.id,
                name: data.name || '',
                description: data.description || '',
            }
        })
        .filter(Boolean)
}

async function buildDefaultActiveProjectsGmailLabelingConfig(userData = {}) {
    const projects = await loadActiveProjectsForDefaultLabels(userData)
    return {
        prompt: DEFAULT_ACTIVE_PROJECTS_PROMPT,
        labelDefinitions: buildDefaultActiveProjectLabelDefinitions(projects),
    }
}

// The learned-rules block persists user feedback across prompt regenerations: in
// default mode the prompt is rebuilt from active projects on every sync, so feedback
// must live outside it and be appended here — the single injection point for both modes.
function appendLearnedRulesToPrompt(prompt = '', learnedRules = '') {
    const rules = typeof learnedRules === 'string' ? learnedRules.trim() : ''
    if (!rules) return prompt
    return [prompt, `User feedback rules (always apply):\n${rules}`].filter(Boolean).join('\n\n')
}

// The user's global self-description gives the classifier the context it needs to
// judge relevance (e.g. cold outreach vs a genuine business opportunity, which
// newsletters the user plausibly subscribed to). The cap is a runaway-cost guard —
// the description is embedded in EVERY per-email classification call — sized so it
// never bites for normal profiles.
function resolveUserDescriptionForClassifier(userData = {}) {
    const description = typeof userData.extendedDescription === 'string' ? userData.extendedDescription.trim() : ''
    return description.slice(0, 15000)
}

async function resolveEffectiveGmailLabelingConfig(config = {}, userData = {}) {
    const userDescription = resolveUserDescriptionForClassifier(userData)
    const promptMode = normalizePromptMode(config.promptMode, GMAIL_LABELING_PROMPT_MODE_CUSTOM)
    if (promptMode !== GMAIL_LABELING_PROMPT_MODE_DEFAULT) {
        return {
            ...config,
            promptMode: GMAIL_LABELING_PROMPT_MODE_CUSTOM,
            prompt: appendLearnedRulesToPrompt(config.prompt, config.learnedRules),
            userDescription,
        }
    }

    const defaultConfig = await buildDefaultActiveProjectsGmailLabelingConfig(userData)
    if (config.enabled && defaultConfig.labelDefinitions.length === 0) {
        throw new Error('Default Gmail labeling requires at least one active project.')
    }

    // The built-in Ads label is regenerated every sync; the user's auto-archive choice
    // for it lives on the config and is applied here.
    const labelDefinitions = defaultConfig.labelDefinitions.map(label =>
        label.key === DEFAULT_ADS_LABEL_DEFINITION.key
            ? { ...label, autoArchive: config.adsAutoArchive === true }
            : label
    )

    return {
        ...config,
        promptMode: GMAIL_LABELING_PROMPT_MODE_DEFAULT,
        prompt: appendLearnedRulesToPrompt(defaultConfig.prompt, config.learnedRules),
        labelDefinitions,
        userDescription,
    }
}

async function loadConfig(userId, projectId, gmailEmail = '') {
    const configRef = getGmailLabelingConfigRef(userId, projectId)
    const configDoc = await configRef.get()
    if (!configDoc.exists) {
        return {
            config: getDefaultGmailLabelingConfig(projectId, gmailEmail),
            exists: false,
            ref: configRef,
        }
    }

    return {
        config: applyGmailLabelingModelMigration(configDoc.data()),
        exists: true,
        ref: configRef,
    }
}

async function loadState(userId, projectId, gmailEmail = '') {
    const stateRef = getGmailLabelingStateRef(userId, projectId)
    const stateDoc = await stateRef.get()
    return {
        state: stateDoc.exists ? stateDoc.data() : buildDefaultState(projectId, gmailEmail),
        exists: stateDoc.exists,
        ref: stateRef,
    }
}

async function loadUserData(userId, providedUserData = null) {
    if (providedUserData) return providedUserData
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    return userDoc.exists ? userDoc.data() || {} : {}
}

// An account-level (email_…) connection and one or more legacy per-project keys can all
// address the SAME Gmail labeling config. These two helpers mirror the expansion the feedback
// writer uses so the read, save, and feedback paths resolve to one canonical config doc.
function getLegacyProjectIdsForEmailConnection(userData = {}, connection = {}) {
    if (!connection || connection.provider !== 'google' || !connection.emailAddress) return []
    const targetEmail = String(connection.emailAddress || '')
        .trim()
        .toLowerCase()
    const apisConnected = userData?.apisConnected || {}
    return Object.keys(apisConnected).filter(projectId => {
        const resolved = resolveEmailConnection(apisConnected[projectId] || {})
        return (
            resolved.connected &&
            resolved.provider === 'google' &&
            String(resolved.emailAddress || '')
                .trim()
                .toLowerCase() === targetEmail
        )
    })
}

function getGmailLabelingLookupKeys(userData = {}, key = '') {
    const keys = [key]
    if (typeof key === 'string' && key.startsWith('email_')) {
        const connection = getConnection(userData, CONNECTION_SERVICE_EMAIL, key)
        if (connection?.provider === 'google') {
            if (connection.defaultProjectId) keys.push(connection.defaultProjectId)
            keys.push(...getLegacyProjectIdsForEmailConnection(userData, connection))
        }
    }
    return [...new Set(keys.filter(Boolean))]
}

// Resolve the canonical config doc for a key: the first lookup key whose config already
// exists (the requested key is checked first, so a migrated account-level doc always wins
// over its disabled legacy doc). Falls back to the requested key so a brand-new config is
// still created under it. Without this, opening the settings panel under the account-level
// connection id reads a non-existent `gmailLabeling_email_…` doc and shows an empty config,
// while feedback and the scheduled sync operate on the project-keyed doc.
async function resolveEffectiveLabelingConfig(userId, userData, key, gmailEmail = '') {
    const lookupKeys = getGmailLabelingLookupKeys(userData, key)
    let fallback = null
    for (const lookupKey of lookupKeys) {
        const loaded = await loadConfig(userId, lookupKey, gmailEmail)
        if (loaded.exists) return { resolvedKey: lookupKey, ...loaded }
        if (!fallback) fallback = { resolvedKey: lookupKey, ...loaded }
    }
    return fallback || { resolvedKey: key, ...(await loadConfig(userId, key, gmailEmail)) }
}

async function upsertGmailLabelingConfig(userId, key, configInput, gmailEmail = '', userData = null) {
    const resolvedUserData = await loadUserData(userId, userData)
    const { resolvedKey, ref, config, exists } = await resolveEffectiveLabelingConfig(
        userId,
        resolvedUserData,
        key,
        gmailEmail
    )
    const writeData = buildConfigWriteData(userId, resolvedKey, configInput, gmailEmail, exists ? config : null)
    // A brand-new config created under an account-level connection id records the connection id
    // and keeps `projectId` pointing at the connection's real default project (consumers and the
    // scheduled scanner rely on it). When we resolve to an existing project-keyed doc,
    // buildConfigWriteData already stamps the correct projectId, so we leave it alone.
    if (typeof resolvedKey === 'string' && resolvedKey.startsWith('email_')) {
        writeData.connectionId = resolvedKey
        const connection = getConnection(resolvedUserData, CONNECTION_SERVICE_EMAIL, resolvedKey)
        if (connection?.defaultProjectId) writeData.projectId = connection.defaultProjectId
    }
    await ref.set(writeData, { merge: true })
    return writeData
}

async function getGmailLabelingConfigWithState(userId, projectId, gmailEmail = '', userData = null) {
    const resolvedUserData = await loadUserData(userId, userData)
    // Resolve to the canonical config doc first so the account-level connection view reads the
    // same project-keyed config (and its state + audit entries) that feedback and sync write.
    const { resolvedKey, config, exists } = await resolveEffectiveLabelingConfig(
        userId,
        resolvedUserData,
        projectId,
        gmailEmail
    )
    const [{ state }, recentAuditEntries, defaultConfigPreview] = await Promise.all([
        loadState(userId, resolvedKey, gmailEmail),
        loadRecentAuditEntries(userId, resolvedKey),
        buildDefaultActiveProjectsGmailLabelingConfig(resolvedUserData),
    ])
    return {
        config: exists ? config : getDefaultGmailLabelingConfig(resolvedKey, gmailEmail),
        defaultConfigPreview,
        state,
        recentAuditEntries,
    }
}

async function acquireSyncLock(userId, projectId, gmailEmail = '') {
    const stateRef = getGmailLabelingStateRef(userId, projectId)
    const now = admin.firestore.Timestamp.now()

    await admin.firestore().runTransaction(async transaction => {
        const stateDoc = await transaction.get(stateRef)
        const stateData = stateDoc.exists ? stateDoc.data() : buildDefaultState(projectId, gmailEmail)
        const lockMillis = stateData.lockAcquiredAt?.toMillis?.() || 0
        const isLocked =
            stateData.status === 'running' && lockMillis > 0 && Date.now() - lockMillis < GMAIL_LABELING_LOCK_TIMEOUT_MS

        if (isLocked) {
            throw new GmailSyncLockedError('A Gmail sync is already running for this project.')
        }

        transaction.set(
            stateRef,
            {
                type: 'gmailLabelingState',
                projectId,
                gmailEmail,
                status: 'running',
                lockAcquiredAt: now,
                lastSyncAt: now,
                lastError: null,
            },
            { merge: true }
        )
    })
}

async function finalizeSyncState(userId, projectId, statePatch, status = 'idle') {
    await getGmailLabelingStateRef(userId, projectId).set(
        {
            ...statePatch,
            status,
            lockAcquiredAt: null,
        },
        { merge: true }
    )
}

async function getCurrentProfileHistoryId(gmail) {
    const profile = await gmail.users.getProfile({ userId: 'me' })
    return profile?.data?.historyId || null
}

async function listBootstrapMessageIds(gmail, config) {
    const query = buildBootstrapQuery(config)
    const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: config.maxMessagesPerRun * MAX_MESSAGES_FETCH_MULTIPLIER,
        q: query,
    })

    return {
        query,
        messageIds: (response?.data?.messages || []).map(message => message.id).filter(Boolean),
    }
}

async function listIncrementalMessageIds(gmail, state, config) {
    const messageIds = new Set()
    let pageToken = undefined
    let pageCount = 0

    while (
        pageCount < MAX_HISTORY_PAGES &&
        messageIds.size < config.maxMessagesPerRun * MAX_MESSAGES_FETCH_MULTIPLIER
    ) {
        const response = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: state.lastHistoryId,
            historyTypes: ['messageAdded'],
            pageToken,
        })

        const histories = response?.data?.history || []
        histories.forEach(history => {
            const messagesAdded = Array.isArray(history.messagesAdded) ? history.messagesAdded : []
            messagesAdded.forEach(entry => {
                const messageId = entry?.message?.id
                if (messageId) messageIds.add(messageId)
            })
        })

        pageToken = response?.data?.nextPageToken
        pageCount += 1

        if (!pageToken) break
    }

    return Array.from(messageIds)
}

async function fetchMessagesByIds(gmail, messageIds) {
    const uniqueIds = Array.from(new Set(messageIds)).filter(Boolean)
    const fetchedMessages = []

    for (const group of chunkArray(uniqueIds, 10)) {
        const responses = await Promise.all(
            group.map(messageId =>
                gmail.users.messages
                    .get({
                        userId: 'me',
                        id: messageId,
                        format: 'full',
                    })
                    .catch(error => {
                        console.warn('[gmailLabeling] Failed fetching Gmail message', {
                            messageId,
                            error: error.message,
                        })
                        return null
                    })
            )
        )

        responses.forEach(response => {
            if (response?.data?.id) fetchedMessages.push(response.data)
        })
    }

    return fetchedMessages
}

function filterCandidateMessages(messages, config) {
    return messages.filter(message => {
        const labelIds = Array.isArray(message.labelIds) ? message.labelIds : []
        const direction = getGmailMessageDirection(message)
        if (direction === GMAIL_DIRECTION_SCOPE_OUTGOING) {
            return labelIds.includes('SENT') && !labelIds.includes('DRAFT')
        }
        if (config.onlyInbox && !labelIds.includes('INBOX')) return false
        if (config.processUnreadOnly && !labelIds.includes('UNREAD')) return false
        return true
    })
}

function shouldBootstrapForScopeExpansion(state, config) {
    const unreadScopeUnknown =
        state.lastHistoryId && typeof state.lastProcessUnreadOnly !== 'boolean' && config.processUnreadOnly === false
    const inboxScopeUnknown =
        state.lastHistoryId && typeof state.lastOnlyInbox !== 'boolean' && config.onlyInbox === false
    const unreadExpanded = state.lastProcessUnreadOnly === true && config.processUnreadOnly === false
    const inboxExpanded = state.lastOnlyInbox === true && config.onlyInbox === false
    return unreadExpanded || inboxExpanded || unreadScopeUnknown || inboxScopeUnknown
}

async function getExistingAuditIds(userId, projectId, messageIds) {
    if (!messageIds.length) return new Set()

    const messageRefs = messageIds.map(messageId => getMessagesAuditCollectionRef(userId, projectId).doc(messageId))
    const snapshots = await admin.firestore().getAll(...messageRefs)
    const existingIds = new Set()
    snapshots.forEach(snapshot => {
        if (snapshot.exists) existingIds.add(snapshot.id)
    })
    return existingIds
}

function normalizeLabelName(labelName = '') {
    return String(labelName || '').trim()
}

function findExistingLabelId(labelMap, labelName) {
    const normalizedLabelName = normalizeLabelName(labelName)
    if (!normalizedLabelName) return null

    const existingLabelId = findLabelIdByName(labelMap, normalizedLabelName)
    // Cache the resolution under the exact requested casing so repeat lookups within the
    // same sync hit the Map directly instead of re-scanning case-insensitively.
    if (existingLabelId && !labelMap.has(normalizedLabelName)) {
        labelMap.set(normalizedLabelName, existingLabelId)
    }

    return existingLabelId
}

async function createOrGetGmailLabelId(gmail, labelMap, labelName) {
    const normalizedLabelName = normalizeLabelName(labelName)
    const existingLabelId = findExistingLabelId(labelMap, normalizedLabelName)
    if (existingLabelId) return existingLabelId

    let createdLabel
    try {
        createdLabel = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name: normalizedLabelName,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            },
        })
    } catch (error) {
        const alreadyExists = error?.code === 409 || error?.response?.status === 409
        if (!alreadyExists) throw error

        const refreshedMap = await loadExistingLabelMap(gmail)
        const refreshedLabelId = findExistingLabelId(refreshedMap, normalizedLabelName)
        if (refreshedLabelId) {
            labelMap.set(normalizedLabelName, refreshedLabelId)
            return refreshedLabelId
        }

        throw new Error(
            `Label name exists or conflicts in Gmail: "${normalizedLabelName}". Use the exact existing Gmail label name or rename this rule label.`
        )
    }

    const labelId = createdLabel?.data?.id || null
    if (!labelId) {
        throw new Error(`Failed creating Gmail label "${normalizedLabelName}"`)
    }

    labelMap.set(normalizedLabelName, labelId)
    return labelId
}

async function loadExistingLabelMap(gmail) {
    const response = await gmail.users.labels.list({ userId: 'me' })
    const map = new Map()
    ;(response?.data?.labels || []).forEach(label => {
        if (label?.name && label?.id) {
            map.set(label.name, label.id)
        }
    })
    return map
}

async function writeAuditRecord(userId, projectId, normalizedMessage, auditData) {
    await getMessagesAuditCollectionRef(userId, projectId)
        .doc(normalizedMessage.messageId)
        .set(
            {
                gmailMessageId: normalizedMessage.messageId,
                gmailThreadId: normalizedMessage.threadId,
                internalDate: normalizedMessage.internalDate,
                from: normalizedMessage.from,
                subject: normalizedMessage.subject,
                snippet: normalizedMessage.snippet,
                processedAt: admin.firestore.Timestamp.now(),
                ...auditData,
            },
            { merge: true }
        )
}

async function loadRecentAuditEntries(userId, projectId, limit = 20) {
    const snapshot = await getMessagesAuditCollectionRef(userId, projectId)
        .orderBy('processedAt', 'desc')
        .limit(limit)
        .get()

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

async function loadAuditEntry(userId, projectId, messageId) {
    if (!messageId) return null
    const snapshot = await getMessagesAuditCollectionRef(userId, projectId).doc(messageId).get()
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null
}

async function getDefaultAssistantIdForProject(userData = {}, projectId = '') {
    const db = admin.firestore()
    const normalizedProjectId = String(projectId || '').trim()
    const userDefaultAssistantId =
        typeof userData?.defaultAssistantId === 'string' ? userData.defaultAssistantId.trim() : ''

    if (!normalizedProjectId) return null

    const assistantExistsInProjectOrGlobal = async assistantId => {
        if (!assistantId) return false
        const [projectAssistantDoc, globalAssistantDoc] = await db.getAll(
            db.doc(`assistants/${normalizedProjectId}/items/${assistantId}`),
            db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`)
        )
        return projectAssistantDoc.exists || globalAssistantDoc.exists
    }

    try {
        const projectDoc = await db.doc(`projects/${normalizedProjectId}`).get()
        const projectAssistantId = projectDoc.exists ? String(projectDoc.data()?.assistantId || '').trim() : ''
        if (projectAssistantId && (await assistantExistsInProjectOrGlobal(projectAssistantId))) {
            return projectAssistantId
        }
    } catch (error) {
        console.warn('[gmailLabeling] Could not resolve project assistant', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    if (userDefaultAssistantId) {
        try {
            if (await assistantExistsInProjectOrGlobal(userDefaultAssistantId)) {
                return userDefaultAssistantId
            }
        } catch (error) {
            console.warn('[gmailLabeling] Could not validate user default assistant', {
                projectId: normalizedProjectId,
                error: error.message,
            })
        }
    }

    try {
        const snapshot = await db.collection(`assistants/${normalizedProjectId}/items`).limit(1).get()
        if (!snapshot.empty) {
            return snapshot.docs[0].id
        }
    } catch (error) {
        console.warn('[gmailLabeling] Could not find assistant in project', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    try {
        const defaultAssistant = await getDefaultAssistantData(admin)
        if (defaultAssistant?.uid) {
            return defaultAssistant.uid
        }
    } catch (error) {
        console.warn('[gmailLabeling] Could not fetch global default assistant', {
            projectId: normalizedProjectId,
            error: error.message,
        })
    }

    return null
}

async function resolvePostLabelAssistantContext(userId, userData = {}) {
    const defaultProjectId = typeof userData?.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    if (!defaultProjectId) {
        return {
            assistantProjectId: null,
            assistantId: null,
            assistant: null,
        }
    }

    const assistantId = await getDefaultAssistantIdForProject(userData, defaultProjectId)
    if (!assistantId) {
        return {
            assistantProjectId: defaultProjectId,
            assistantId: null,
            assistant: null,
        }
    }

    const assistant = await getAssistantForChat(defaultProjectId, assistantId, userId, { forceRefresh: true })
    return {
        assistantProjectId: defaultProjectId,
        assistantId,
        assistant,
    }
}

function buildPostLabelActionSkipped({
    prompt = '',
    promptHash = '',
    status = 'skipped',
    error = '',
    assistantProjectId = null,
    assistantId = null,
    goldSpent = 0,
    estimatedNormalGoldCost = 0,
    tokenUsage = null,
}) {
    return {
        prompt,
        promptHash,
        assistantProjectId,
        assistantId,
        executedToolNames: [],
        executedToolCallsCount: 0,
        assistantResponse: '',
        status,
        error: error || '',
        goldSpent: Number.isFinite(goldSpent) ? goldSpent : 0,
        estimatedNormalGoldCost: Number.isFinite(estimatedNormalGoldCost) ? estimatedNormalGoldCost : 0,
        tokenUsage,
        executedAt: admin.firestore.Timestamp.now(),
    }
}

function getDefinitionDirectionScope(definition = {}) {
    const scope = typeof definition.directionScope === 'string' ? definition.directionScope.trim().toLowerCase() : ''
    if (scope === GMAIL_DIRECTION_SCOPE_OUTGOING || scope === GMAIL_DIRECTION_SCOPE_BOTH) return scope
    return GMAIL_DIRECTION_SCOPE_INCOMING
}

function getEligibleLabelDefinitions(labelDefinitions = [], direction = GMAIL_DIRECTION_SCOPE_INCOMING) {
    return (Array.isArray(labelDefinitions) ? labelDefinitions : []).filter(label => {
        const scope = getDefinitionDirectionScope(label)
        return scope === GMAIL_DIRECTION_SCOPE_BOTH || scope === direction
    })
}

function getExternalRecipientEmails(normalizedMessage = {}, gmailEmail = '') {
    const connectedEmail = typeof gmailEmail === 'string' ? gmailEmail.trim().toLowerCase() : ''
    const recipients = extractEmailAddresses(normalizedMessage.to)

    return Array.from(new Set(recipients.filter(email => email && email !== connectedEmail)))
}

function getTargetContactName(
    normalizedMessage = {},
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = ''
) {
    if (direction === GMAIL_DIRECTION_SCOPE_OUTGOING) {
        const normalizedTargetEmail =
            typeof targetContactEmail === 'string' ? targetContactEmail.trim().toLowerCase() : ''
        if (!normalizedTargetEmail) return ''

        const outgoingCandidates = [
            ...parseEmailHeaderAddresses(normalizedMessage.to),
            ...parseEmailHeaderAddresses(normalizedMessage.cc),
            ...parseEmailHeaderAddresses(normalizedMessage.bcc),
        ]
        const match = outgoingCandidates.find(entry => entry.email === normalizedTargetEmail)
        return match?.displayName || ''
    }

    const incomingSender = parseEmailHeaderAddresses(normalizedMessage.from)[0]
    return incomingSender?.displayName || ''
}

function getTargetContactEmail(
    normalizedMessage = {},
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = ''
) {
    if (direction === GMAIL_DIRECTION_SCOPE_OUTGOING) {
        return typeof targetContactEmail === 'string' ? targetContactEmail.trim().toLowerCase() : ''
    }

    const incomingSender = parseEmailHeaderAddresses(normalizedMessage.from)[0]
    return incomingSender?.email || ''
}

function buildPostLabelAssistantMessages({
    prompt,
    normalizedMessage,
    selectedDefinition,
    gmailEmail,
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = '',
    targetContactName = '',
}) {
    const gmailWebUrl = buildGmailMessageUrl(gmailEmail, normalizedMessage.messageId)
    const resolvedTargetContactEmail = getTargetContactEmail(normalizedMessage, direction, targetContactEmail)
    return [
        [
            'system',
            'You are executing a follow-up action after a Gmail labeling rule matched. Use your available tools when needed. Return a concise execution summary. If a required tool is not available, say so clearly and do not claim completion.',
        ],
        [
            'user',
            parseTextForUseLiKePrompt(
                [
                    `Direction: ${direction}`,
                    `Matched Gmail rule key: ${selectedDefinition.key}`,
                    `Matched Gmail label: ${selectedDefinition.gmailLabelName}`,
                    `Matched Gmail direction scope: ${getDefinitionDirectionScope(selectedDefinition)}`,
                    `Gmail messageId: ${normalizedMessage.messageId || ''}`,
                    `Gmail threadId: ${normalizedMessage.threadId || ''}`,
                    `Gmail web URL: ${gmailWebUrl || ''}`,
                    `From: ${normalizedMessage.from || ''}`,
                    `To: ${normalizedMessage.to || ''}`,
                    `Cc: ${normalizedMessage.cc || ''}`,
                    `Target contact email: ${resolvedTargetContactEmail || ''}`,
                    `Target contact name: ${targetContactName || ''}`,
                    `Date: ${normalizedMessage.date || ''}`,
                    `Subject: ${normalizedMessage.subject || ''}`,
                    `Snippet: ${normalizedMessage.snippet || ''}`,
                    `Body:\n${normalizedMessage.bodyText || ''}`,
                    '',
                    `Follow-up instruction: ${prompt}`,
                ].join('\n')
            ),
        ],
    ]
}

function buildPostLabelGmailContext({
    normalizedMessage,
    gmailEmail,
    assistantProjectId,
    connectionProjectId = '',
    selectedProjectId = '',
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = '',
    targetContactName = '',
}) {
    const messageId = typeof normalizedMessage?.messageId === 'string' ? normalizedMessage.messageId.trim() : ''
    const threadId = typeof normalizedMessage?.threadId === 'string' ? normalizedMessage.threadId.trim() : ''
    const normalizedEmail = typeof gmailEmail === 'string' ? gmailEmail.trim().toLowerCase() : ''
    const resolvedTargetContactEmail = getTargetContactEmail(normalizedMessage, direction, targetContactEmail)

    return {
        origin: 'gmail_label_follow_up',
        gmailEmail: normalizedEmail,
        projectId: connectionProjectId || assistantProjectId || '',
        connectionProjectId: connectionProjectId || assistantProjectId || '',
        assistantProjectId: assistantProjectId || '',
        selectedProjectId: selectedProjectId || '',
        messageId,
        threadId,
        webUrl: buildGmailMessageUrl(normalizedEmail, messageId),
        archiveOnComplete: direction === GMAIL_DIRECTION_SCOPE_OUTGOING ? false : true,
        direction,
        targetContactEmail: resolvedTargetContactEmail,
        targetContactName: typeof targetContactName === 'string' ? targetContactName.trim() : '',
    }
}

async function addRoutingCommentsToCreatedGmailTasks({
    userData = {},
    createdTaskResults = [],
    normalizedMessage = {},
    selectedDefinition = {},
    reasoning = '',
    confidence = null,
    selectedProjectId = null,
}) {
    if (!Array.isArray(createdTaskResults) || createdTaskResults.length === 0) return []

    const commentResults = []
    for (const createdTask of createdTaskResults) {
        if (!createdTask?.projectId || !createdTask?.taskId) continue

        try {
            const commentResult = await addProjectRoutingReasonComment({
                userData,
                projectId: createdTask.projectId,
                taskId: createdTask.taskId,
                task: createdTask.task,
                projectName: createdTask.projectName || '',
                reasoning,
                confidence,
                source: 'gmail_labeling',
                routingKey: normalizedMessage.messageId || '',
                sourceDataField: 'gmailData',
                routingData: {
                    messageId: normalizedMessage.messageId || '',
                    threadId: normalizedMessage.threadId || '',
                    selectedLabelKey: selectedDefinition.key || '',
                    selectedGmailLabelName: selectedDefinition.gmailLabelName || '',
                    selectedProjectId: selectedProjectId || null,
                    matched: true,
                },
            })

            if (commentResult) {
                commentResults.push({
                    taskId: createdTask.taskId,
                    projectId: createdTask.projectId,
                    commentId: commentResult.commentId,
                })
            }
        } catch (error) {
            console.warn('[gmailLabeling] Failed adding routing comment to created Gmail task', {
                taskId: createdTask.taskId,
                projectId: createdTask.projectId,
                messageId: normalizedMessage.messageId || '',
                error: error.message,
            })
        }
    }

    return commentResults
}

async function executePostLabelPrompt({
    userId,
    userData,
    selectedDefinition,
    normalizedMessage,
    gmailEmail,
    direction = GMAIL_DIRECTION_SCOPE_INCOMING,
    targetContactEmail = '',
    forceExecute = false,
    existingAuditEntry = null,
    reasoning = '',
    confidence = null,
    connectionProjectId = '',
    selectedProjectId = null,
}) {
    const prompt =
        typeof selectedDefinition?.postLabelPrompt === 'string' ? selectedDefinition.postLabelPrompt.trim() : ''
    const promptHash = createPostLabelPromptHash(selectedDefinition?.key || '', prompt)
    const postLabelPromptDirectionScope =
        typeof selectedDefinition?.postLabelPromptDirectionScope === 'string'
            ? selectedDefinition.postLabelPromptDirectionScope.trim().toLowerCase()
            : ''

    if (!prompt) {
        return buildPostLabelActionSkipped({ prompt: '', promptHash: '', status: 'skipped' })
    }

    if (
        postLabelPromptDirectionScope &&
        postLabelPromptDirectionScope !== GMAIL_DIRECTION_SCOPE_BOTH &&
        postLabelPromptDirectionScope !== direction
    ) {
        return buildPostLabelActionSkipped({ prompt, promptHash, status: 'skipped' })
    }

    if (
        !forceExecute &&
        existingAuditEntry?.postLabelAction?.status === 'completed' &&
        existingAuditEntry?.postLabelAction?.promptHash === promptHash
    ) {
        return {
            ...existingAuditEntry.postLabelAction,
            status: 'skipped',
            error: '',
        }
    }

    const { assistantProjectId, assistantId, assistant } = await resolvePostLabelAssistantContext(userId, userData)
    if (!assistantProjectId || !assistantId || !assistant) {
        return buildPostLabelActionSkipped({
            prompt,
            promptHash,
            status: 'blocked',
            error: 'No assistant could be resolved for the user default project.',
            assistantProjectId,
            assistantId,
        })
    }

    const allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []
    const messages = []
    const targetContactName = getTargetContactName(normalizedMessage, direction, targetContactEmail)

    await addBaseInstructions(
        messages,
        assistant.displayName || assistant.name || 'Assistant',
        'English',
        assistant.instructions || 'You are a helpful assistant.',
        allowedTools,
        null,
        {
            projectId: assistantProjectId,
            assistantId,
        }
    )
    messages.push(
        ...buildPostLabelAssistantMessages({
            prompt,
            normalizedMessage,
            selectedDefinition,
            gmailEmail,
            direction,
            targetContactEmail,
            targetContactName,
        })
    )

    try {
        const gmailContext = buildPostLabelGmailContext({
            normalizedMessage,
            gmailEmail,
            assistantProjectId,
            connectionProjectId,
            selectedProjectId,
            direction,
            targetContactEmail,
            targetContactName,
        })
        const stream = await interactWithChatStream(messages, assistant.model, assistant.temperature, allowedTools, {
            projectId: assistantProjectId,
            assistantId,
            requestUserId: userId,
            gmailContext,
        })
        const result = await collectAssistantTextWithToolCalls({
            stream,
            conversationHistory: messages,
            modelKey: assistant.model,
            temperatureKey: assistant.temperature,
            allowedTools,
            toolRuntimeContext: {
                projectId: assistantProjectId,
                assistantId,
                requestUserId: userId,
                gmailContext,
            },
        })
        const totalTokens = calculateTokens(
            result?.assistantResponse || '',
            Array.isArray(result?.finalConversation) ? result.finalConversation : messages,
            assistant.model
        )
        const routingCommentResults = await addRoutingCommentsToCreatedGmailTasks({
            userData,
            createdTaskResults: result?.createdTaskResults || [],
            normalizedMessage,
            selectedDefinition,
            reasoning,
            confidence,
            selectedProjectId,
        })
        const estimatedNormalGoldCost = calculateGoldCostFromTokens(totalTokens, assistant.model)
        let goldSpent = 0
        if (estimatedNormalGoldCost > 0) {
            const goldResult = await deductGold(userId, estimatedNormalGoldCost, {
                source: 'gmail_label_follow_up',
                projectId: assistantProjectId,
                objectId: normalizedMessage?.messageId || '',
                channel: 'gmail',
            })
            if (goldResult?.success) {
                goldSpent = estimatedNormalGoldCost
            } else {
                console.warn('[gmailLabeling] Failed to deduct gold for post-label prompt', {
                    userId,
                    assistantProjectId,
                    assistantId,
                    messageId: normalizedMessage?.messageId || '',
                    requestedGold: estimatedNormalGoldCost,
                    currentGold: goldResult?.currentGold ?? null,
                })
            }
        }

        return {
            prompt,
            promptHash,
            assistantProjectId,
            assistantId,
            executedToolNames: Array.isArray(result?.executedToolNames) ? result.executedToolNames : [],
            executedToolCallsCount: Number(result?.executedToolCallsCount) || 0,
            createdTaskResults: Array.isArray(result?.createdTaskResults) ? result.createdTaskResults : [],
            routingCommentResults,
            assistantResponse: result?.assistantResponse || '',
            status: 'completed',
            error: '',
            goldSpent,
            estimatedNormalGoldCost,
            tokenUsage: {
                totalTokens,
            },
            executedAt: admin.firestore.Timestamp.now(),
        }
    } catch (error) {
        const isBlocked = error.message?.includes('Tool not permitted')
        return {
            prompt,
            promptHash,
            assistantProjectId,
            assistantId,
            executedToolNames: [],
            executedToolCallsCount: 0,
            assistantResponse: '',
            status: isBlocked ? 'blocked' : 'failed',
            error: error.message || 'Failed to execute follow-up prompt.',
            goldSpent: 0,
            estimatedNormalGoldCost: 0,
            tokenUsage: null,
            executedAt: admin.firestore.Timestamp.now(),
        }
    }
}

async function applyLabelAndArchive(gmail, normalizedMessage, labelId, autoArchive, direction) {
    const shouldArchive = direction !== GMAIL_DIRECTION_SCOPE_OUTGOING && autoArchive
    const removeLabelIds = shouldArchive && normalizedMessage.labelIds.includes('INBOX') ? ['INBOX'] : []
    await gmail.users.messages.modify({
        userId: 'me',
        id: normalizedMessage.messageId,
        requestBody: {
            addLabelIds: [labelId],
            removeLabelIds,
        },
    })

    return {
        applied: true,
        archived: shouldArchive && removeLabelIds.includes('INBOX'),
    }
}

// Labels the email line renders as a "section" but that are not removable user labels.
const NON_REMOVABLE_SECTION_LABEL_IDS = new Set(['INBOX', '__NO_LABEL__'])

// Pure computation of the Gmail label add/remove sets for a user's label correction, isolated so
// the archive/inbox edge cases are unit-testable without a Gmail client. A null targetLabelId is
// "Inbox only" (restore the plain inbox, no managed label). INBOX is only removed when the corrected
// label auto-archives; the old section label is removed otherwise (never a system/synthetic id).
function buildThreadLabelModification({ currentLabelId, targetLabelId, targetAutoArchive }) {
    const addLabelIds = []
    const removeLabelIds = []
    if (targetLabelId) {
        addLabelIds.push(targetLabelId)
        if (targetAutoArchive) removeLabelIds.push('INBOX')
    } else {
        addLabelIds.push('INBOX')
    }
    if (currentLabelId && currentLabelId !== targetLabelId && !NON_REMOVABLE_SECTION_LABEL_IDS.has(currentLabelId)) {
        removeLabelIds.push(currentLabelId)
    }
    return { addLabelIds: [...new Set(addLabelIds)], removeLabelIds: [...new Set(removeLabelIds)] }
}

// Re-label a whole Gmail thread in response to a user's label correction from the feedback UI.
// Removes the label the thread currently sits under (currentLabelId) and applies the corrected
// label, resolved BY NAME (targetLabelName) so any configured label can be a target — including
// ones with no current inbox emails, or that Gmail hasn't created yet (createOrGetGmailLabelId
// creates it on demand). Mirrors the sync's auto-archive behavior for the corrected label. A null
// targetLabelName means "Inbox only": the managed label is removed and the thread returns to a
// plain inbox. Operates on the whole thread in one call (threads.modify) so every message moves,
// matching how the email line groups threads. Returns the resolved target label name/key + archive
// state so the caller can update the audit record and the client can move the row.
async function applyGmailThreadLabelCorrection(
    userId,
    projectId,
    { threadId, currentLabelId, targetLabelName, labelDefinitions = [] }
) {
    if (!threadId) throw new Error('threadId is required to re-label an email')

    const { connectionProjectId } = await getConnectedGmailEmail(userId, projectId)
    const gmail = await getGmailClient(userId, connectionProjectId || projectId)
    const labelMap = await loadExistingLabelMap(gmail)

    const normalizedTargetName =
        typeof targetLabelName === 'string' && targetLabelName.trim() ? normalizeLabelName(targetLabelName) : null

    let targetLabelId = null
    let targetGmailLabelName = null
    let targetLabelKey = null
    let targetAutoArchive = false
    if (normalizedTargetName) {
        targetLabelId = await createOrGetGmailLabelId(gmail, labelMap, normalizedTargetName)
        targetGmailLabelName = normalizedTargetName
        const targetDefinition = (labelDefinitions || []).find(
            definition => normalizeLabelName(definition.gmailLabelName) === normalizedTargetName
        )
        if (targetDefinition) {
            targetLabelKey = targetDefinition.key || null
            targetAutoArchive = targetDefinition.autoArchive === true
        }
    }

    const { addLabelIds, removeLabelIds } = buildThreadLabelModification({
        currentLabelId,
        targetLabelId,
        targetAutoArchive,
    })

    await gmail.users.threads.modify({
        userId: 'me',
        id: threadId,
        requestBody: { addLabelIds, removeLabelIds },
    })

    return {
        applied: true,
        archived: removeLabelIds.includes('INBOX'),
        targetLabelId: targetLabelId || null,
        targetGmailLabelName,
        targetLabelKey,
    }
}

async function processSingleMessage({
    gmail,
    labelMap,
    config,
    userId,
    userData,
    projectId,
    // Real project behind the connection — used for gold ledger + follow-up routing;
    // `projectId` may be an account-level connection id (the doc key).
    connectionProjectId = '',
    gmailEmail,
    rawMessage,
    syncRunId,
    forceFollowUp = false,
}) {
    const goldProjectId = connectionProjectId || projectId
    const normalizedMessage = normalizeGmailMessage(rawMessage)
    const direction = getGmailMessageDirection(rawMessage)
    const eligibleLabelDefinitions = getEligibleLabelDefinitions(config.labelDefinitions, direction)
    const promptVersion = config.updatedAt || admin.firestore.Timestamp.now()
    const existingAuditEntry = await loadAuditEntry(userId, projectId, normalizedMessage.messageId)

    // Check the user has at least the minimum balance to run the classifier.
    // No Gold is deducted here — we only want a single ledger entry per email,
    // created after classification based on actual token usage.
    const preClassifyUserSnapshot = await admin.firestore().collection('users').doc(userId).get()
    const preClassifyUserGold = Number(preClassifyUserSnapshot.data()?.gold) || 0
    if (preClassifyUserGold < GMAIL_LABELING_MIN_GOLD_TO_CLASSIFY) {
        logSync('Skipping Gmail labeling because user has insufficient gold', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            requiredGold: GMAIL_LABELING_MIN_GOLD_TO_CLASSIFY,
            currentGold: preClassifyUserGold,
        })

        await writeAuditRecord(userId, projectId, normalizedMessage, {
            syncRunId,
            direction,
            selectedLabelKey: null,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: null,
            reasoning: 'Skipped before classification because the user has insufficient gold.',
            needsReply: null,
            applied: false,
            archived: false,
            skippedReason: 'insufficient_gold',
            promptVersion,
            postLabelAction: buildPostLabelActionSkipped({ status: 'skipped' }),
        })

        return {
            labeled: 0,
            archived: 0,
            skipped: 1,
            goldSpent: 0,
            insufficientGold: true,
        }
    }

    let classifierResult
    try {
        classifierResult = await classifyGmailMessage({
            config: {
                ...config,
                labelDefinitions: eligibleLabelDefinitions,
            },
            message: {
                ...normalizedMessage,
                direction,
            },
        })
    } catch (error) {
        // No Gold was deducted before classification, so no refund is needed.
        console.warn('[gmailLabeling] Gmail classification failed', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            error: error.message,
        })
        throw error
    }

    logSync('Classified Gmail message', {
        userId,
        projectId,
        messageId: normalizedMessage.messageId,
        threadId: normalizedMessage.threadId,
        direction,
        matched: classifierResult.matched,
        labelKey: classifierResult.labelKey || null,
        confidence: classifierResult.confidence,
        reasoning: classifierResult.reasoning,
        tokenUsage: classifierResult.usage || null,
        consistencyCheck: classifierResult.consistencyCheck || null,
    })

    const tokenUsage = classifierResult?.usage || null
    const estimatedNormalGoldCost = tokenUsage?.totalTokens
        ? calculateGoldCostFromTokens(tokenUsage.totalTokens, config.model)
        : 0

    // Outgoing mail never needs a reply from the user, regardless of what the model returned.
    const needsReply = direction === GMAIL_DIRECTION_SCOPE_OUTGOING ? false : classifierResult.needsReply === true

    // Charge the real token-based cost in a single ledger entry. If tokens round
    // to 0 Gold we still charge a minimum of 1 so usage is reflected somewhere.
    const goldToCharge = Math.max(estimatedNormalGoldCost, GMAIL_LABELING_MIN_GOLD_TO_CLASSIFY)

    logSync('Gmail classifier gold accounting inputs', {
        userId,
        projectId,
        messageId: normalizedMessage.messageId,
        model: config?.model || null,
        tokenUsage,
        estimatedNormalGoldCost,
        goldToCharge,
    })

    let classificationGoldSpent = 0
    let insufficientGoldForClassification = false
    const chargeResult = await deductGold(userId, goldToCharge, {
        source: 'gmail_labeling',
        projectId: goldProjectId,
        objectId: normalizedMessage.messageId,
        channel: 'gmail',
    })
    if (chargeResult?.success) {
        classificationGoldSpent = goldToCharge
    } else {
        // Balance ran out between the pre-check and the post-classify deduction.
        // The classifier work already happened; record under-charge and halt sync.
        insufficientGoldForClassification = true
        console.warn('[gmailLabeling] Unable to deduct classifier gold cost', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            estimatedNormalGoldCost,
            goldToCharge,
            currentGold: chargeResult?.currentGold ?? null,
        })
    }

    logSync('Gmail classifier gold accounting result', {
        userId,
        projectId,
        messageId: normalizedMessage.messageId,
        classificationGoldSpent,
        insufficientGoldForClassification,
    })

    if (!classifierResult.matched) {
        await writeAuditRecord(userId, projectId, normalizedMessage, {
            syncRunId,
            direction,
            selectedLabelKey: null,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: classifierResult.confidence,
            reasoning: classifierResult.reasoning,
            needsReply,
            consistencyCheck: classifierResult.consistencyCheck || null,
            applied: false,
            archived: false,
            skippedReason: 'no_match',
            promptVersion,
            postLabelAction: buildPostLabelActionSkipped({ status: 'skipped' }),
        })

        return {
            labeled: 0,
            archived: 0,
            skipped: 1,
            goldSpent: classificationGoldSpent,
            estimatedNormalGoldCost,
            insufficientGold: insufficientGoldForClassification,
        }
    }

    const selectedDefinition = eligibleLabelDefinitions.find(label => label.key === classifierResult.labelKey)
    if (!selectedDefinition) {
        await writeAuditRecord(userId, projectId, normalizedMessage, {
            syncRunId,
            direction,
            selectedLabelKey: classifierResult.labelKey,
            selectedGmailLabelName: null,
            autoArchive: false,
            confidence: classifierResult.confidence,
            reasoning: classifierResult.reasoning,
            needsReply,
            applied: false,
            archived: false,
            skippedReason: 'missing_label_definition',
            promptVersion,
            postLabelAction: buildPostLabelActionSkipped({ status: 'skipped' }),
        })

        return {
            labeled: 0,
            archived: 0,
            skipped: 1,
            goldSpent: classificationGoldSpent,
            estimatedNormalGoldCost,
            insufficientGold: insufficientGoldForClassification,
        }
    }
    const selectedProjectId =
        typeof selectedDefinition.sourceProjectId === 'string' && selectedDefinition.sourceProjectId.trim()
            ? selectedDefinition.sourceProjectId.trim()
            : null

    let labelId
    let modifyResult
    try {
        labelId = selectedDefinition.gmailLabelName.startsWith(ALDDONE_MANAGED_LABEL_PREFIX)
            ? await createOrGetGmailLabelId(gmail, labelMap, selectedDefinition.gmailLabelName)
            : await createOrGetGmailLabelId(gmail, labelMap, selectedDefinition.gmailLabelName)

        logSync('Applying Gmail label to message', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            threadId: normalizedMessage.threadId,
            selectedLabelKey: selectedDefinition.key,
            selectedGmailLabelName: selectedDefinition.gmailLabelName,
            labelId,
            autoArchive: !!selectedDefinition.autoArchive,
            direction,
        })

        modifyResult = await applyLabelAndArchive(
            gmail,
            normalizedMessage,
            labelId,
            selectedDefinition.autoArchive,
            direction
        )
    } catch (error) {
        if (classificationGoldSpent > 0) {
            await refundGold(userId, classificationGoldSpent, {
                source: 'gmail_labeling',
                projectId: goldProjectId,
                objectId: normalizedMessage.messageId,
                channel: 'gmail',
                note: 'Refund real classifier cost after Gmail label apply failure',
            })
        }
        console.warn('[gmailLabeling] Refunded gold after Gmail label resolution/apply failure', {
            userId,
            projectId,
            messageId: normalizedMessage.messageId,
            refundedGold: classificationGoldSpent,
            error: error.message,
        })
        throw error
    }

    const targetContactEmails =
        direction === GMAIL_DIRECTION_SCOPE_OUTGOING ? getExternalRecipientEmails(normalizedMessage, gmailEmail) : ['']
    const postLabelActions = []
    let followUpGoldSpent = 0
    let followUpEstimatedNormalGoldCost = 0

    for (const targetContactEmail of targetContactEmails) {
        const action = await executePostLabelPrompt({
            userId,
            userData,
            selectedDefinition,
            normalizedMessage,
            gmailEmail,
            direction,
            targetContactEmail,
            forceExecute: forceFollowUp,
            existingAuditEntry,
            reasoning: classifierResult.reasoning,
            confidence: classifierResult.confidence,
            connectionProjectId: goldProjectId,
            selectedProjectId,
        })
        postLabelActions.push(action)
        followUpGoldSpent += Number(action?.goldSpent) || 0
        followUpEstimatedNormalGoldCost += Number(action?.estimatedNormalGoldCost) || 0
    }

    const primaryPostLabelAction = postLabelActions[0] || buildPostLabelActionSkipped({ status: 'skipped' })

    await writeAuditRecord(userId, projectId, normalizedMessage, {
        syncRunId,
        direction,
        selectedLabelKey: selectedDefinition.key,
        selectedGmailLabelName: selectedDefinition.gmailLabelName,
        selectedProjectId,
        selectedProjectSource: selectedProjectId ? 'default_project_label' : 'gmail_label',
        autoArchive: direction === GMAIL_DIRECTION_SCOPE_OUTGOING ? false : !!selectedDefinition.autoArchive,
        confidence: classifierResult.confidence,
        reasoning: classifierResult.reasoning,
        needsReply,
        consistencyCheck: classifierResult.consistencyCheck || null,
        applied: modifyResult.applied,
        archived: modifyResult.archived,
        skippedReason: null,
        promptVersion,
        recipientEmails: targetContactEmails.filter(Boolean),
        postLabelAction: primaryPostLabelAction,
        postLabelActions,
    })

    return {
        labeled: 1,
        archived: modifyResult.archived ? 1 : 0,
        skipped: 0,
        goldSpent: classificationGoldSpent + followUpGoldSpent,
        estimatedNormalGoldCost: estimatedNormalGoldCost + followUpEstimatedNormalGoldCost,
        insufficientGold: insufficientGoldForClassification,
    }
}

// The labeling key is an account-level connection id (new) or a projectId (legacy).
// Returns the connected Gmail address plus the real project behind the connection —
// used for gold ledger entries and follow-up task routing, never the raw key.
async function getConnectedGmailEmail(userId, key) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    if (!userDoc.exists) {
        throw new Error('User not found')
    }

    const userData = userDoc.data() || {}

    if (typeof key === 'string' && key.startsWith('email_')) {
        const connection = getConnection(userData, CONNECTION_SERVICE_EMAIL, key)
        if (!connection || connection.provider !== 'google') {
            throw new Error('Gmail is not connected for this account')
        }
        return {
            userData,
            gmailEmail: connection.emailAddress || userData.email || '',
            connectionProjectId: connection.defaultProjectId || '',
        }
    }

    const gmailConnection = userData.apisConnected?.[key] || {}
    if (gmailConnection.gmail) {
        return {
            userData,
            gmailEmail: gmailConnection.gmailEmail || userData.email || '',
            connectionProjectId: key,
        }
    }

    // A project whose connection exists account-level only (new connect flow).
    const [match] = findConnectionsForProject(userData, CONNECTION_SERVICE_EMAIL, key)
    if (match && match.provider === 'google') {
        return {
            userData,
            gmailEmail: match.emailAddress || userData.email || '',
            connectionProjectId: key,
        }
    }

    throw new Error('Gmail is not connected for this project')
}

function assertPremiumAccess(userData) {
    if (userData?.premium?.status !== 'premium') {
        const error = new Error('Gmail labeling is available for premium users only.')
        error.code = 'premium-required'
        throw error
    }
}

async function syncGmailLabeling(userId, projectId, options = {}) {
    const { gmailEmail, userData, connectionProjectId } = await getConnectedGmailEmail(userId, projectId)
    const logContext = createSyncLogContext(userId, projectId, gmailEmail)
    assertPremiumAccess(userData)
    const { config, exists } = await loadConfig(userId, projectId, gmailEmail)
    const effectiveConfig = exists ? await resolveEffectiveGmailLabelingConfig(config, userData) : config

    logSync('Starting Gmail labeling sync', {
        ...logContext,
        options,
        configExists: exists,
        configEnabled: effectiveConfig?.enabled,
        promptMode: effectiveConfig?.promptMode || null,
        processUnreadOnly: effectiveConfig?.processUnreadOnly,
        onlyInbox: effectiveConfig?.onlyInbox,
        maxMessagesPerRun: effectiveConfig?.maxMessagesPerRun,
        lookbackDays: effectiveConfig?.lookbackDays,
    })

    if (!exists || !effectiveConfig.enabled) {
        logSync('Skipping Gmail labeling sync because config is missing or disabled', {
            ...logContext,
            skippedReason: exists ? 'disabled' : 'missing_config',
        })
        return {
            success: true,
            scanned: 0,
            classified: 0,
            labeled: 0,
            archived: 0,
            skipped: 0,
            lastHistoryId: null,
            lastError: null,
            skippedReason: exists ? 'disabled' : 'missing_config',
        }
    }

    await acquireSyncLock(userId, projectId, gmailEmail)

    try {
        const gmail = await getGmailClient(userId, projectId)
        const { state } = await loadState(userId, projectId, gmailEmail)
        const labelMap = await loadExistingLabelMap(gmail)
        const syncStartHistoryId = await getCurrentProfileHistoryId(gmail)
        const bootstrapForScopeExpansion = shouldBootstrapForScopeExpansion(state, effectiveConfig)

        logSync('Loaded Gmail labeling sync state', {
            ...logContext,
            lastHistoryId: state.lastHistoryId || null,
            lastProcessUnreadOnly:
                typeof state.lastProcessUnreadOnly === 'boolean' ? state.lastProcessUnreadOnly : null,
            lastOnlyInbox: typeof state.lastOnlyInbox === 'boolean' ? state.lastOnlyInbox : null,
            syncStartHistoryId: syncStartHistoryId || null,
            bootstrapForScopeExpansion,
            forceBootstrap: !!options.forceBootstrap,
        })

        let messageIds = []
        let resetHistory = false
        let syncMode = 'incremental'
        let bootstrapQuery = null

        if (state.lastHistoryId && !options.forceBootstrap && !bootstrapForScopeExpansion) {
            try {
                messageIds = await listIncrementalMessageIds(gmail, state, effectiveConfig)
                logSync('Fetched incremental Gmail message ids', {
                    ...logContext,
                    lastHistoryId: state.lastHistoryId,
                    incrementalCount: messageIds.length,
                })
            } catch (error) {
                const staleHistory =
                    error?.code === 404 ||
                    error?.response?.status === 404 ||
                    error?.message?.toLowerCase?.().includes('historyid')
                if (!staleHistory) throw error
                resetHistory = true
                logSync('Resetting Gmail history cursor after stale historyId', {
                    ...logContext,
                    lastHistoryId: state.lastHistoryId,
                    error: error.message,
                })
            }
        }

        if (!state.lastHistoryId || options.forceBootstrap || resetHistory || bootstrapForScopeExpansion) {
            const bootstrapResult = await listBootstrapMessageIds(gmail, effectiveConfig)
            messageIds = bootstrapResult.messageIds
            bootstrapQuery = bootstrapResult.query
            syncMode = bootstrapForScopeExpansion ? 'bootstrap_scope_expansion' : 'bootstrap'
            logSync('Fetched bootstrap Gmail message ids', {
                ...logContext,
                syncMode,
                bootstrapQuery,
                bootstrapCount: messageIds.length,
                hadLastHistoryId: !!state.lastHistoryId,
                resetHistory,
            })
        }

        const fetchedMessages = await fetchMessagesByIds(gmail, messageIds)
        logSync('Fetched Gmail messages by id', {
            ...logContext,
            syncMode,
            requestedMessageCount: messageIds.length,
            fetchedMessageCount: fetchedMessages.length,
        })

        const candidateMessages = filterCandidateMessages(fetchedMessages, effectiveConfig).slice(
            0,
            effectiveConfig.maxMessagesPerRun
        )
        logSync('Filtered Gmail candidate messages', {
            ...logContext,
            syncMode,
            fetchedMessageCount: fetchedMessages.length,
            candidateMessageCount: candidateMessages.length,
            processUnreadOnly: effectiveConfig.processUnreadOnly,
            onlyInbox: effectiveConfig.onlyInbox,
            lookbackDays: effectiveConfig.lookbackDays,
            maxMessagesPerRun: effectiveConfig.maxMessagesPerRun,
        })

        const processedMessageIds = options.forceBootstrap
            ? new Set()
            : await getExistingAuditIds(
                  userId,
                  projectId,
                  candidateMessages.map(message => message.id)
              )
        const messagesToProcess = options.forceBootstrap
            ? candidateMessages
            : candidateMessages.filter(message => !processedMessageIds.has(message.id))

        logSync('Prepared Gmail messages for processing', {
            ...logContext,
            syncMode,
            candidateMessageCount: candidateMessages.length,
            alreadyProcessedCount: processedMessageIds.size,
            messageCountToProcess: messagesToProcess.length,
        })

        let labeled = 0
        let archived = 0
        let skipped = candidateMessages.length - messagesToProcess.length
        let goldSpent = 0
        let estimatedNormalGoldSpent = 0
        let syncLastError = null

        for (const rawMessage of messagesToProcess) {
            try {
                logSync('Processing Gmail message', {
                    ...logContext,
                    messageId: rawMessage.id,
                    threadId: rawMessage.threadId,
                    labelIds: rawMessage.labelIds || [],
                })
                const result = await processSingleMessage({
                    gmail,
                    labelMap,
                    config: effectiveConfig,
                    userId,
                    userData,
                    projectId,
                    connectionProjectId,
                    gmailEmail,
                    rawMessage,
                    syncRunId: logContext.runId,
                    forceFollowUp: !!options.forceBootstrap,
                })
                labeled += result.labeled
                archived += result.archived
                skipped += result.skipped
                goldSpent += result.goldSpent || 0
                estimatedNormalGoldSpent += result.estimatedNormalGoldCost || 0
                logSync('Finished processing Gmail message', {
                    ...logContext,
                    messageId: rawMessage.id,
                    labeled: result.labeled,
                    archived: result.archived,
                    skipped: result.skipped,
                    goldSpent: result.goldSpent || 0,
                    estimatedNormalGoldCost: result.estimatedNormalGoldCost || 0,
                    insufficientGold: !!result.insufficientGold,
                })
                if (result.insufficientGold) {
                    syncLastError = 'Insufficient Gold to label additional emails.'
                    logSync('Stopping Gmail labeling sync after insufficient gold', {
                        ...logContext,
                        messageId: rawMessage.id,
                        goldSpent,
                    })
                    break
                }
            } catch (error) {
                console.error('[gmailLabeling] Failed processing Gmail message', {
                    ...logContext,
                    projectId,
                    userId,
                    messageId: rawMessage.id,
                    error: error.message,
                })

                const normalizedMessage = normalizeGmailMessage(rawMessage)
                const direction = getGmailMessageDirection(rawMessage)
                await writeAuditRecord(userId, projectId, normalizedMessage, {
                    syncRunId: logContext.runId,
                    direction,
                    selectedLabelKey: null,
                    selectedGmailLabelName: null,
                    autoArchive: false,
                    confidence: null,
                    reasoning: error.message,
                    applied: false,
                    archived: false,
                    skippedReason: 'processing_error',
                    promptVersion: effectiveConfig.updatedAt || admin.firestore.Timestamp.now(),
                    postLabelAction: buildPostLabelActionSkipped({ status: 'skipped' }),
                })
                skipped += 1
            }
        }

        const latestHistoryId = await getCurrentProfileHistoryId(gmail)
        const now = admin.firestore.Timestamp.now()
        const resolvedHistoryId = syncStartHistoryId || latestHistoryId || state.lastHistoryId || null

        await finalizeSyncState(
            userId,
            projectId,
            {
                type: 'gmailLabelingState',
                projectId,
                gmailEmail,
                lastHistoryId: resolvedHistoryId,
                lastSuccessfulSyncAt: now,
                lastSyncAt: now,
                lastRunId: logContext.runId,
                lastError: syncLastError,
                lastProcessedCount: candidateMessages.length,
                lastLabeledCount: labeled,
                lastArchivedCount: archived,
                lastProcessUnreadOnly: effectiveConfig.processUnreadOnly,
                lastOnlyInbox: effectiveConfig.onlyInbox,
            },
            'idle'
        )

        logSync('Completed Gmail labeling sync', {
            ...logContext,
            syncMode,
            bootstrapQuery,
            scanned: candidateMessages.length,
            classified: messagesToProcess.length,
            labeled,
            archived,
            skipped,
            goldSpent,
            resolvedHistoryId,
            lastError: syncLastError,
        })

        return {
            success: true,
            scanned: candidateMessages.length,
            classified: messagesToProcess.length,
            labeled,
            archived,
            skipped,
            goldSpent,
            estimatedNormalGoldSpent,
            lastSyncAt: now,
            lastRunId: logContext.runId,
            recentAuditEntries: await loadRecentAuditEntries(userId, projectId),
            lastHistoryId: resolvedHistoryId,
            lastError: syncLastError,
            gmailEmail,
            userId,
            projectId,
            syncMode,
        }
    } catch (error) {
        const now = admin.firestore.Timestamp.now()
        await finalizeSyncState(
            userId,
            projectId,
            {
                type: 'gmailLabelingState',
                projectId,
                gmailEmail,
                lastSyncAt: now,
                lastError: error.message,
                lastProcessUnreadOnly: effectiveConfig.processUnreadOnly,
                lastOnlyInbox: effectiveConfig.onlyInbox,
            },
            'error'
        )
        console.error('[gmailLabeling] Gmail labeling sync failed', {
            ...logContext,
            error: error.message,
            stack: error.stack,
        })
        throw error
    }
}

async function processEnabledGmailLabelingConfigs(limit = 100) {
    const snapshot = await admin
        .firestore()
        .collectionGroup('private')
        .where('type', '==', GMAIL_LABELING_CONFIG_TYPE)
        .where('enabled', '==', true)
        .limit(limit)
        .get()

    const results = []

    for (const doc of snapshot.docs) {
        const data = doc.data() || {}
        const parent = doc.ref.parent?.parent
        const userId = parent?.id
        // The migration disables + stamps old project-keyed configs with `migratedTo`;
        // skipping them here is the double-processing guard.
        if (data.migratedTo) continue
        // New configs are keyed by connectionId; legacy ones by projectId.
        const syncKey = data.connectionId || data.projectId
        if (!userId || !syncKey) continue

        try {
            const { state } = await loadState(userId, syncKey, data.gmailEmail || '')
            if (!isScheduledSyncDue(state, data)) {
                results.push({
                    success: true,
                    skippedReason: 'interval_not_due',
                    userId,
                    projectId: syncKey,
                    syncIntervalMinutes: getConfiguredSyncIntervalMinutes(data),
                })
                continue
            }

            const result = await syncGmailLabeling(userId, syncKey)
            results.push(result)
        } catch (error) {
            if (error?.code === 'premium-required') {
                console.log('[gmailLabeling] Scheduled sync skipped because premium is required', {
                    userId,
                    projectId: data.projectId,
                })
                results.push({
                    success: false,
                    skippedReason: 'premium_required',
                    userId,
                    projectId: data.projectId,
                })
                continue
            }

            if (error instanceof GmailSyncLockedError) {
                results.push({
                    success: false,
                    skippedReason: 'locked',
                    userId,
                    projectId: data.projectId,
                })
                continue
            }

            console.error('[gmailLabeling] Scheduled sync failed', {
                userId,
                projectId: data.projectId,
                error: error.message,
            })
            results.push({
                success: false,
                userId,
                projectId: data.projectId,
                lastError: error.message,
            })
        }
    }

    return results
}

module.exports = {
    GmailSyncLockedError,
    applyGmailThreadLabelCorrection,
    buildThreadLabelModification,
    buildDefaultActiveProjectLabelDefinitions,
    buildDefaultActiveProjectsGmailLabelingConfig,
    buildDefaultProjectFollowUpPrompt,
    buildGmailMessageUrl,
    buildPostLabelGmailContext,
    createPostLabelPromptHash,
    executePostLabelPrompt,
    getGmailLabelingConfigWithState,
    getGmailLabelingLookupKeys,
    getDefaultAssistantIdForProject,
    getExternalRecipientEmails,
    loadAuditEntry,
    loadConfig,
    processEnabledGmailLabelingConfigs,
    processSingleMessage,
    resolveEffectiveGmailLabelingConfig,
    resolveEffectiveLabelingConfig,
    resolvePostLabelAssistantContext,
    syncGmailLabeling,
    upsertGmailLabelingConfig,
}
