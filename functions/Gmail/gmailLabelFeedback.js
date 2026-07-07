'use strict'

const admin = require('firebase-admin')

const { getCachedEnvFunctions, getOpenAIClient } = require('../Assistant/assistantHelper')
const {
    CONNECTION_SERVICE_EMAIL,
    getConnection,
    resolveEmailConnection,
} = require('../Integrations/providerConnections')
const { extractJsonFromText, isGpt5ReasoningModel, mapAssistantModelToOpenAIModel } = require('./gmailPromptClassifier')
const { MAX_LEARNED_RULES_LENGTH, getGmailLabelingStateRef } = require('./gmailLabelingConfig')

// Feedback is free (a single nano call) — the cap only bounds abuse.
const FEEDBACK_DAILY_CAP = 30
const FEEDBACK_REVISION_MODEL = 'MODEL_GPT5_4_NANO'

const REVISION_SYSTEM_PROMPT =
    'You maintain a compact list of user feedback rules for an AI email labeling assistant. ' +
    'Given the current rules, the configured labels, one email, the label decision the assistant made, and the ' +
    "user's correction, produce the updated rules list. Merge the new feedback into the existing rules: " +
    'generalize when the feedback matches an existing rule, add a new rule otherwise, and drop rules the feedback ' +
    'contradicts. Rules may include concrete examples (sender domains, subjects) when they help. Keep the list ' +
    `short and specific — plain-text bullet lines starting with "- ", ${MAX_LEARNED_RULES_LENGTH} characters maximum. ` +
    'Return strict JSON only with the single key learnedRules.'

function buildFeedbackDayKey() {
    return new Date().toISOString().slice(0, 10)
}

async function enforceDailyFeedbackCap(userId, projectId) {
    const stateRef = getGmailLabelingStateRef(userId, projectId)
    const dayKey = buildFeedbackDayKey()

    await admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(stateRef)
        const state = snapshot.exists ? snapshot.data() || {} : {}
        const sameDay = state.feedbackCountDate === dayKey
        const count = sameDay ? Number(state.feedbackCountDay) || 0 : 0

        if (count >= FEEDBACK_DAILY_CAP) {
            const error = new Error('Daily feedback limit reached. Try again tomorrow.')
            error.code = 'FEEDBACK_LIMIT'
            throw error
        }

        transaction.set(stateRef, { feedbackCountDate: dayKey, feedbackCountDay: count + 1 }, { merge: true })
    })
}

function describeLabelOptions(labelDefinitions = []) {
    return labelDefinitions.map(label => ({
        key: label.key,
        gmailLabelName: label.gmailLabelName,
        description: label.description,
    }))
}

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

async function resolveFeedbackLabelingContext({ userId, userData, projectId, messageId }) {
    const { loadConfig, loadAuditEntry } = require('./serverSideGmailLabelingSync')
    const lookupKeys = getGmailLabelingLookupKeys(userData, projectId)
    let firstConfiguredContext = null

    for (const key of lookupKeys) {
        const configContext = await loadConfig(userId, key)
        if (!configContext.exists) continue
        if (!firstConfiguredContext) firstConfiguredContext = { key, ...configContext }

        const auditEntry = await loadAuditEntry(userId, key, messageId)
        if (auditEntry) return { key, ...configContext, auditEntry }
    }

    if (!firstConfiguredContext) {
        const error = new Error('Enable email labeling before giving label feedback')
        error.code = 'LABELING_NOT_CONFIGURED'
        throw error
    }

    const error = new Error('This email has not been processed by the labeling sync yet')
    error.code = 'AUDIT_ENTRY_NOT_FOUND'
    throw error
}

async function reviseLearnedRules({ currentRules, labelDefinitions, auditEntry, verdict, correctLabel, note }) {
    const envFunctions = getCachedEnvFunctions()
    const openAiKey = envFunctions?.OPEN_AI_KEY
    if (!openAiKey) throw new Error('Feedback revision unavailable: missing OpenAI key')

    const openai = getOpenAIClient(openAiKey)
    const selectedModel = mapAssistantModelToOpenAIModel(FEEDBACK_REVISION_MODEL)

    const userContent =
        `Current rules:\n${currentRules || '(none)'}\n\n` +
        `Configured labels:\n${JSON.stringify(describeLabelOptions(labelDefinitions), null, 2)}\n\n` +
        `Email:\n${JSON.stringify(
            {
                from: auditEntry.from || '',
                subject: auditEntry.subject || '',
                snippet: auditEntry.snippet || '',
                direction: auditEntry.direction || 'incoming',
            },
            null,
            2
        )}\n\n` +
        `Assistant decision:\n${JSON.stringify(
            {
                labelKey: auditEntry.selectedLabelKey || null,
                gmailLabelName: auditEntry.selectedGmailLabelName || null,
                reasoning: auditEntry.reasoning || '',
                needsReply: auditEntry.needsReply === true,
            },
            null,
            2
        )}\n\n` +
        `User feedback:\n${JSON.stringify(
            {
                verdict,
                correctLabel: correctLabel || null,
                note: note || '',
            },
            null,
            2
        )}\n\n` +
        'Return JSON exactly like {"learnedRules":"- Emails from acme.com are always the Acme project label\\n- ..."}.'

    const requestParams = {
        model: selectedModel,
        messages: [
            { role: 'system', content: REVISION_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
        ],
    }
    if (!isGpt5ReasoningModel(FEEDBACK_REVISION_MODEL)) {
        requestParams.temperature = 0.1
    }

    const completion = await openai.chat.completions.create(requestParams)
    const content = completion?.choices?.[0]?.message?.content || ''
    const parsed = extractJsonFromText(content)
    const revised = typeof parsed?.learnedRules === 'string' ? parsed.learnedRules.trim() : ''
    if (!revised) throw new Error('Feedback revision produced no rules text')
    return revised.slice(0, MAX_LEARNED_RULES_LENGTH)
}

// Stores the feedback event on the email's audit record and immediately folds it into
// the config's learnedRules block, which resolveEffectiveGmailLabelingConfig appends to
// the classifier prompt on every future sync (both prompt modes).
async function submitEmailLabelFeedback({ userId, userData, projectId, messageId, verdict, correctLabel, note }) {
    const normalizedVerdict = verdict === 'wrong' ? 'wrong' : null
    if (!normalizedVerdict) throw new Error('Unsupported feedback verdict')
    if (!messageId || typeof messageId !== 'string') throw new Error('messageId is required')

    const { resolveEffectiveGmailLabelingConfig } = require('./serverSideGmailLabelingSync')
    const { key: feedbackProjectId, config, ref: configRef, auditEntry } = await resolveFeedbackLabelingContext({
        userId,
        userData,
        projectId,
        messageId,
    })

    await enforceDailyFeedbackCap(userId, feedbackProjectId)

    const feedbackEvent = {
        verdict: normalizedVerdict,
        correctLabel: typeof correctLabel === 'string' && correctLabel.trim() ? correctLabel.trim() : null,
        note: typeof note === 'string' ? note.trim().slice(0, 500) : '',
        previousLabelKey: auditEntry.selectedLabelKey || null,
        userId,
        at: admin.firestore.Timestamp.now(),
    }

    const auditRef = getGmailLabelingStateRef(userId, feedbackProjectId).collection('messages').doc(messageId)
    await auditRef.set({ feedback: admin.firestore.FieldValue.arrayUnion(feedbackEvent) }, { merge: true })

    const effectiveConfig = await resolveEffectiveGmailLabelingConfig(config, userData)
    const learnedRules = await reviseLearnedRules({
        currentRules: typeof config.learnedRules === 'string' ? config.learnedRules : '',
        labelDefinitions: effectiveConfig.labelDefinitions || [],
        auditEntry,
        verdict: normalizedVerdict,
        correctLabel: feedbackEvent.correctLabel,
        note: feedbackEvent.note,
    })

    await configRef.set({ learnedRules, updatedAt: admin.firestore.Timestamp.now() }, { merge: true })

    return { learnedRules }
}

module.exports = {
    submitEmailLabelFeedback,
    FEEDBACK_DAILY_CAP,
}
