// AT-3102: every email gets a Gmail label (fallback when the classifier picks none), and an email
// whose classification or label write failed is retried a bounded number of times even though its
// audit record (the "already processed" marker) exists. These suites run the real
// syncGmailLabeling/processSingleMessage against an in-memory Firestore, so the processed-marker
// and retry bookkeeping is exercised across several sync runs.

jest.mock('firebase-admin', () => {
    const store = new Map()
    const hooks = { failSet: null }

    const isDirectChild = (collectionPath, docPath) =>
        docPath.startsWith(`${collectionPath}/`) && !docPath.slice(collectionPath.length + 1).includes('/')

    const snapshotOf = path => {
        const data = store.get(path)
        return {
            id: path.split('/').pop(),
            exists: data !== undefined,
            data: () => (data === undefined ? undefined : { ...data }),
            ref: docRef(path),
        }
    }

    function docRef(path) {
        return {
            id: path.split('/').pop(),
            path,
            get: async () => snapshotOf(path),
            set: async (data, options = {}) => {
                if (hooks.failSet && hooks.failSet(path, data)) throw new Error('Firestore write failed')
                const current = store.get(path)
                store.set(path, options.merge && current ? { ...current, ...data } : { ...data })
            },
            update: async patch => {
                store.set(path, { ...(store.get(path) || {}), ...patch })
            },
            collection: name => collectionRef(`${path}/${name}`),
        }
    }

    function query(collectionPath, filters = [], limit = Infinity) {
        return {
            where: (field, op, value) => query(collectionPath, [...filters, { field, op, value }], limit),
            orderBy: () => query(collectionPath, filters, limit),
            limit: count => query(collectionPath, filters, count),
            get: async () => {
                const docs = [...store.keys()]
                    .filter(path => isDirectChild(collectionPath, path))
                    .filter(path =>
                        filters.every(({ field, op, value }) => op === '==' && store.get(path)[field] === value)
                    )
                    .slice(0, limit)
                    .map(snapshotOf)
                return { docs, empty: docs.length === 0, size: docs.length }
            },
        }
    }

    function collectionRef(path) {
        return { path, doc: id => docRef(`${path}/${id}`), ...query(path) }
    }

    const db = {
        collection: path => collectionRef(path),
        doc: path => docRef(path),
        getAll: async (...refs) => Promise.all(refs.map(ref => ref.get())),
        runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref, data, options) => ref.set(data, options) }),
    }

    return { firestore: Object.assign(() => db, {}), __store: store, __hooks: hooks }
})

jest.mock('googleapis', () => ({ google: { gmail: jest.fn() } }))
jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({ getAuthorizedOAuth2Client: jest.fn(async () => ({})) }))
jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: jest.fn(() => Promise.resolve()),
    addChatCommentFromAssistantTool: jest.fn(),
    calculateTokens: jest.fn(() => 0),
    calculateGoldCostFromTokens: jest.fn(() => 2),
    collectAssistantTextWithToolCalls: jest.fn(),
    getAssistantForChat: jest.fn(async () => null),
    interactWithChatStream: jest.fn(),
    parseTextForUseLiKePrompt: jest.fn(text => text),
}))
jest.mock('../Firestore/assistantsFirestore', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    getDefaultAssistantData: jest.fn(async () => null),
}))
jest.mock('../Gold/goldHelper', () => ({
    deductGold: jest.fn(async () => ({ success: true })),
    refundGold: jest.fn(async () => ({ success: true })),
}))
jest.mock('../Users/usersFirestore', () => ({ adGoldToUser: jest.fn() }))
jest.mock('./gmailPromptClassifier', () => ({ classifyGmailMessage: jest.fn() }))
jest.mock('./emailCommentReadSync', () => ({
    ...jest.requireActual('./emailCommentReadSync'),
    reconcileEmailCommentReadState: jest.fn(async () => ({ candidates: 0 })),
}))
jest.mock('../shared/projectRoutingCommentHelper', () => ({
    addProjectRoutingReasonComment: jest.fn(async () => ({ commentId: 'routing-comment' })),
}))
jest.mock('../Email/emailThreadContinuation', () => ({
    continueEmailThread: jest.fn(async () => null),
    appendOriginEmailToTask: jest.fn(async () => ({ commentId: 'email_origin', existing: false })),
}))
jest.mock('../Email/emailThreadTopicStore', () => ({
    resolveEmailThreadTopicForMessage: jest.fn(async () => null),
    appendSentMessageToThreadTopic: jest.fn(async () => ({ written: 1, commentId: 'sent-comment' })),
    postTaskLinkInThreadTopic: jest.fn(async () => ({ written: 1 })),
}))

const admin = require('firebase-admin')
const { google } = require('googleapis')
const assistantHelper = require('../Assistant/assistantHelper')
const { deductGold, refundGold } = require('../Gold/goldHelper')
const { classifyGmailMessage } = require('./gmailPromptClassifier')
const { continueEmailThread } = require('../Email/emailThreadContinuation')
const {
    FALLBACK_NEWSLETTER_LABEL_DEFINITION,
    FALLBACK_OTHER_LABEL_DEFINITION,
    MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS,
    buildDefaultActiveProjectLabelDefinitions,
    getFallbackReason,
    processSingleMessage,
    recordMessageProcessingError,
    resolveEffectiveGmailLabelingConfig,
    resolveFallbackLabelDefinition,
    syncGmailLabeling,
} = require('./serverSideGmailLabelingSync')

const USER_ID = 'user-1'
const CONNECTION_KEY = 'project-business'
const AUDIT_PREFIX = `users/${USER_ID}/private/gmailLabelingState_${CONNECTION_KEY}/messages`
const STATE_PATH = `users/${USER_ID}/private/gmailLabelingState_${CONNECTION_KEY}`

const PROJECTS = [
    { id: 'project-business', name: 'Alldone Business', description: '' },
    { id: 'project-private', name: 'Privat', description: '' },
]
// The default-mode labels exactly as the sync builds them: project labels with their follow-up
// prompt, plus the built-in Ads label.
const DEFAULT_MODE_LABELS = buildDefaultActiveProjectLabelDefinitions(PROJECTS, 'project-business')
const DEFAULT_MODE_CONFIG = {
    model: 'MODEL_GPT5_5',
    promptMode: 'default',
    autoArchiveAllLabeled: false,
    confidenceThreshold: 0.7,
    labelDefinitions: DEFAULT_MODE_LABELS,
    defaultProjectId: 'project-business',
    updatedAt: 'prompt-version',
}

const auditPath = messageId => `${AUDIT_PREFIX}/${messageId}`
const readAudit = messageId => admin.__store.get(auditPath(messageId))

function buildRawMessage(id, labelIds = ['INBOX', 'UNREAD']) {
    return {
        id,
        threadId: `thread-${id}`,
        internalDate: '1795010519000',
        labelIds,
        payload: {
            headers: [
                { name: 'From', value: 'Eleni from Modash <roi@modash.io>' },
                { name: 'To', value: 'Me <me@example.com>' },
                { name: 'Subject', value: 'Steal these influencer team structures' },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from('Newsletter body').toString('base64url') },
        },
        snippet: 'Newsletter body',
    }
}

function buildGmail({ messages = {}, historyMessageIds = [] } = {}) {
    let labelCounter = 0
    return {
        users: {
            getProfile: jest.fn(async () => ({ data: { historyId: '200' } })),
            history: {
                list: jest.fn(async () => ({
                    data: { history: historyMessageIds.map(id => ({ messagesAdded: [{ message: { id } }] })) },
                })),
            },
            labels: {
                list: jest.fn(async () => ({ data: { labels: [] } })),
                create: jest.fn(async ({ requestBody }) => ({
                    data: { id: `label-${++labelCounter}-${requestBody.name}` },
                })),
            },
            messages: {
                get: jest.fn(async ({ id }) => {
                    if (!messages[id]) throw new Error('Requested entity was not found.')
                    return { data: messages[id] }
                }),
                modify: jest.fn(async () => ({})),
            },
        },
    }
}

function seedSyncDocs() {
    const store = admin.__store
    store.set(`users/${USER_ID}`, {
        premium: { status: 'premium' },
        gold: 500,
        email: 'me@example.com',
        defaultProjectId: 'project-business',
        projectIds: PROJECTS.map(project => project.id),
        apisConnected: { [CONNECTION_KEY]: { gmail: true, gmailEmail: 'me@example.com' } },
    })
    PROJECTS.forEach(project =>
        store.set(`projects/${project.id}`, { name: project.name, description: '', active: true })
    )
    store.set(`users/${USER_ID}/private/gmailLabeling_${CONNECTION_KEY}`, {
        type: 'gmailLabelingConfig',
        enabled: true,
        promptMode: 'default',
        projectId: CONNECTION_KEY,
        gmailEmail: 'me@example.com',
        model: 'MODEL_GPT5_5',
        processUnreadOnly: false,
        onlyInbox: true,
        autoArchiveAllLabeled: false,
        maxMessagesPerRun: 20,
        confidenceThreshold: 0.7,
        updatedAt: 'prompt-version',
    })
    store.set(STATE_PATH, {
        type: 'gmailLabelingState',
        status: 'idle',
        lastHistoryId: '100',
        lastProcessUnreadOnly: false,
        lastOnlyInbox: true,
    })
}

const noMatchNotification = {
    matched: false,
    labelKey: null,
    rawLabelKey: null,
    rawMatched: false,
    confidence: 0.9,
    reasoning: 'An automated notification that does not relate to any configured project.',
    followUpType: 'informational',
    needsReply: false,
    emailKind: 'notification',
    usage: { totalTokens: 100 },
}

beforeEach(() => {
    jest.clearAllMocks()
    admin.__store.clear()
    admin.__hooks.failSet = null
    deductGold.mockImplementation(async () => ({ success: true }))
    refundGold.mockImplementation(async () => ({ success: true }))
    continueEmailThread.mockImplementation(async () => null)
})

describe('resolveFallbackLabelDefinition (AT-3102)', () => {
    test('a newsletter gets the built-in Newsletter label even when a default project label exists', () => {
        const fallback = resolveFallbackLabelDefinition({
            config: DEFAULT_MODE_CONFIG,
            labelDefinitions: DEFAULT_MODE_LABELS,
            emailKind: 'newsletter',
        })
        expect(fallback).toMatchObject({
            key: 'newsletter',
            gmailLabelName: 'Newsletter',
            postLabelPrompt: '',
            autoArchive: false,
            fallbackKind: 'newsletter',
        })
        expect(FALLBACK_NEWSLETTER_LABEL_DEFINITION.gmailLabelName).toBe('Newsletter')
    })

    test('a configured `newsletter` label is reused, without its prompt or its own archiving', () => {
        const fallback = resolveFallbackLabelDefinition({
            config: { promptMode: 'custom' },
            labelDefinitions: [
                {
                    key: 'newsletter',
                    gmailLabelName: 'Alldone/Newsletter',
                    autoArchive: true,
                    postLabelPrompt: 'Summarize it',
                },
            ],
            emailKind: 'newsletter',
        })
        expect(fallback).toMatchObject({
            key: 'newsletter',
            gmailLabelName: 'Alldone/Newsletter',
            postLabelPrompt: '',
            autoArchive: false,
        })
    })

    test('any other email gets the connection default project label, stripped of its follow-up prompt', () => {
        const defaultProjectLabel = DEFAULT_MODE_LABELS.find(label => label.sourceProjectId === 'project-business')
        expect(defaultProjectLabel.postLabelPrompt).toBeTruthy()

        for (const emailKind of ['notification', 'person', 'ads', null]) {
            const fallback = resolveFallbackLabelDefinition({
                config: DEFAULT_MODE_CONFIG,
                labelDefinitions: DEFAULT_MODE_LABELS,
                emailKind,
            })
            expect(fallback).toMatchObject({
                key: defaultProjectLabel.key,
                gmailLabelName: 'Alldone Business',
                sourceProjectId: 'project-business',
                postLabelPrompt: '',
                autoArchive: false,
                fallbackKind: 'default_project',
            })
        }
    })

    test('without a default project label (inactive/missing project, custom mode) the catch-all is Alldone/Other', () => {
        expect(FALLBACK_OTHER_LABEL_DEFINITION.gmailLabelName).toBe('Alldone/Other')
        const missingProject = resolveFallbackLabelDefinition({
            config: { ...DEFAULT_MODE_CONFIG, defaultProjectId: 'archived-project' },
            labelDefinitions: DEFAULT_MODE_LABELS,
            emailKind: 'notification',
        })
        const customMode = resolveFallbackLabelDefinition({
            config: { promptMode: 'custom' },
            labelDefinitions: [{ key: 'urgent', gmailLabelName: 'Alldone/Urgent' }],
            emailKind: 'person',
        })
        for (const fallback of [missingProject, customMode]) {
            expect(fallback).toMatchObject({
                key: 'alldone_other',
                gmailLabelName: 'Alldone/Other',
                postLabelPrompt: '',
                fallbackKind: 'other',
            })
        }
    })
})

describe('getFallbackReason', () => {
    test('distinguishes no match, below threshold and an unknown label key', () => {
        expect(getFallbackReason({ matched: false, rawMatched: false, confidence: 0.9 }, {})).toBe('no_match')
        expect(
            getFallbackReason(
                { matched: false, rawMatched: true, rawLabelKey: 'project_x', confidence: 0.55 },
                { confidenceThreshold: 0.7 }
            )
        ).toBe('below_threshold')
        expect(getFallbackReason({ matched: true, labelKey: 'gone' }, {})).toBe('missing_label_definition')
    })
})

describe('resolveEffectiveGmailLabelingConfig exposes the fallback project', () => {
    test('default mode carries the connection default project id', async () => {
        admin.__store.set('projects/project-business', { name: 'Alldone Business', active: true })
        const effective = await resolveEffectiveGmailLabelingConfig(
            { enabled: true, promptMode: 'default', projectId: 'project-business' },
            { projectIds: ['project-business'], defaultProjectId: 'other-project' }
        )
        expect(effective.defaultProjectId).toBe('project-business')
        expect(
            resolveFallbackLabelDefinition({ config: effective, labelDefinitions: effective.labelDefinitions })
        ).toMatchObject({ gmailLabelName: 'Alldone Business', fallbackKind: 'default_project' })
    })
})

describe('processSingleMessage applies a fallback label (AT-3102)', () => {
    beforeEach(() => {
        admin.__store.set(`users/${USER_ID}`, { gold: 500 })
    })

    const processWith = ({ gmail, config = DEFAULT_MODE_CONFIG, userData = {}, rawMessage } = {}) =>
        processSingleMessage({
            gmail,
            labelMap: new Map(),
            config,
            userId: USER_ID,
            userData: { defaultProjectId: 'project-business', ...userData },
            projectId: CONNECTION_KEY,
            connectionProjectId: CONNECTION_KEY,
            gmailEmail: 'me@example.com',
            rawMessage: rawMessage || buildRawMessage('m-1'),
            syncRunId: 'run-1',
        })

    test('no match: default project label, original diagnostics kept, no follow-up prompt, one charge', async () => {
        const consistencyCheck = { ran: true, corrected: false, trigger: { type: 'zero_confidence' } }
        classifyGmailMessage.mockResolvedValue({ ...noMatchNotification, consistencyCheck })
        const gmail = buildGmail()

        const result = await processWith({ gmail })

        expect(result).toMatchObject({ labeled: 1, fallbackLabeled: 1, skipped: 0, archived: 0 })
        expect(gmail.users.labels.create).toHaveBeenCalledWith(
            expect.objectContaining({ requestBody: expect.objectContaining({ name: 'Alldone Business' }) })
        )
        expect(gmail.users.messages.modify).toHaveBeenCalledWith({
            userId: 'me',
            id: 'm-1',
            requestBody: { addLabelIds: ['label-1-Alldone Business'], removeLabelIds: [] },
        })
        // The project's follow-up prompt (task creation / Daily emails digest) never runs.
        expect(assistantHelper.interactWithChatStream).not.toHaveBeenCalled()
        expect(assistantHelper.collectAssistantTextWithToolCalls).not.toHaveBeenCalled()
        expect(deductGold).toHaveBeenCalledTimes(1)
        expect(refundGold).not.toHaveBeenCalled()
        expect(result.goldSpent).toBe(2)

        expect(readAudit('m-1')).toMatchObject({
            selectedLabelKey: 'project_project_business',
            selectedGmailLabelName: 'Alldone Business',
            selectedProjectId: 'project-business',
            selectedProjectSource: 'fallback_label',
            labelSource: 'fallback',
            fallbackReason: 'no_match',
            fallbackKind: 'default_project',
            classifierMatched: false,
            classifierLabelKey: null,
            classifierRawLabelKey: null,
            confidence: 0.9,
            reasoning: noMatchNotification.reasoning,
            emailKind: 'notification',
            consistencyCheck,
            applied: true,
            archived: false,
            skippedReason: null,
            processingErrorRetryPending: false,
            postLabelAction: expect.objectContaining({ prompt: '', status: 'skipped' }),
        })
    })

    test('below threshold: the default project label, not the low-confidence pick; the pick stays on record', async () => {
        classifyGmailMessage.mockResolvedValue({
            ...noMatchNotification,
            rawMatched: true,
            rawLabelKey: 'project_project_private',
            confidence: 0.55,
            reasoning: 'Possibly private, not sure.',
        })
        const gmail = buildGmail()

        await processWith({ gmail })

        expect(gmail.users.labels.create).toHaveBeenCalledTimes(1)
        expect(gmail.users.labels.create).toHaveBeenCalledWith(
            expect.objectContaining({ requestBody: expect.objectContaining({ name: 'Alldone Business' }) })
        )
        expect(readAudit('m-1')).toMatchObject({
            selectedGmailLabelName: 'Alldone Business',
            labelSource: 'fallback',
            fallbackReason: 'below_threshold',
            classifierRawLabelKey: 'project_project_private',
            classifierRawMatched: true,
            confidence: 0.55,
            reasoning: 'Possibly private, not sure.',
        })
    })

    test('a newsletter (the reported Modash case) gets the Newsletter label', async () => {
        classifyGmailMessage.mockResolvedValue({
            ...noMatchNotification,
            emailKind: 'newsletter',
            reasoning: 'Subscribed newsletter, not Ads, no configured project.',
        })
        const gmail = buildGmail()

        await processWith({ gmail })

        expect(gmail.users.labels.create).toHaveBeenCalledWith(
            expect.objectContaining({ requestBody: expect.objectContaining({ name: 'Newsletter' }) })
        )
        expect(readAudit('m-1')).toMatchObject({
            selectedLabelKey: 'newsletter',
            selectedGmailLabelName: 'Newsletter',
            selectedProjectId: null,
            labelSource: 'fallback',
            fallbackKind: 'newsletter',
            emailKind: 'newsletter',
        })
        expect(assistantHelper.collectAssistantTextWithToolCalls).not.toHaveBeenCalled()
    })

    test('an unknown label key from the classifier falls back too', async () => {
        classifyGmailMessage.mockResolvedValue({ ...noMatchNotification, matched: true, labelKey: 'deleted_label' })
        const gmail = buildGmail()

        await processWith({ gmail })

        expect(readAudit('m-1')).toMatchObject({
            selectedGmailLabelName: 'Alldone Business',
            fallbackReason: 'missing_label_definition',
            classifierMatched: true,
            classifierLabelKey: 'deleted_label',
        })
    })

    test('without the default project label the email gets Alldone/Other, never no label', async () => {
        classifyGmailMessage.mockResolvedValue(noMatchNotification)
        const gmail = buildGmail()

        await processWith({ gmail, config: { ...DEFAULT_MODE_CONFIG, defaultProjectId: 'archived-project' } })

        expect(gmail.users.labels.create).toHaveBeenCalledWith(
            expect.objectContaining({ requestBody: expect.objectContaining({ name: 'Alldone/Other' }) })
        )
        expect(readAudit('m-1')).toMatchObject({
            selectedGmailLabelName: 'Alldone/Other',
            fallbackKind: 'other',
            selectedProjectId: null,
            applied: true,
        })
    })

    test('a fallback label does not archive on "archive all labeled", only by the unread setting', async () => {
        classifyGmailMessage.mockResolvedValue({ ...noMatchNotification, emailKind: 'newsletter' })
        const config = { ...DEFAULT_MODE_CONFIG, autoArchiveAllLabeled: true }

        const keepGmail = buildGmail()
        const kept = await processWith({ gmail: keepGmail, config })
        expect(kept.archived).toBe(0)
        expect(keepGmail.users.messages.modify).toHaveBeenCalledWith(
            expect.objectContaining({ requestBody: expect.objectContaining({ removeLabelIds: [] }) })
        )

        const archiveGmail = buildGmail()
        const archived = await processWith({
            gmail: archiveGmail,
            config,
            userData: { unreadEmailSettings: { newsletter: 'archive' } },
            rawMessage: buildRawMessage('m-2'),
        })
        expect(archived.archived).toBe(1)
        expect(archiveGmail.users.messages.modify).toHaveBeenCalledTimes(1)
        expect(archiveGmail.users.messages.modify).toHaveBeenCalledWith(
            expect.objectContaining({
                requestBody: { addLabelIds: ['label-1-Newsletter'], removeLabelIds: ['INBOX'] },
            })
        )
        expect(readAudit('m-2')).toMatchObject({ archivedForUnreadSettings: true, archived: true })
    })

    test('actionable mail under a fallback label is never archived by the unread setting', async () => {
        classifyGmailMessage.mockResolvedValue({
            ...noMatchNotification,
            emailKind: 'newsletter',
            followUpType: 'actionable',
        })
        const gmail = buildGmail()

        const result = await processWith({ gmail, userData: { unreadEmailSettings: { newsletter: 'archive' } } })

        expect(result.archived).toBe(0)
        expect(readAudit('m-1')).toMatchObject({ archivedForUnreadSettings: false, archived: false })
    })

    test('a classifier match still runs its follow-up prompt (only fallback labels skip it)', async () => {
        classifyGmailMessage.mockResolvedValue({
            ...noMatchNotification,
            matched: true,
            labelKey: 'project_project_private',
            confidence: 0.95,
        })
        assistantHelper.getAssistantForChat.mockResolvedValueOnce(null)
        const gmail = buildGmail()

        await processWith({ gmail })

        expect(readAudit('m-1')).toMatchObject({
            selectedGmailLabelName: 'Privat',
            labelSource: 'classifier',
            fallbackReason: null,
            // The prompt was attempted; it is blocked here only because the test has no assistant.
            postLabelAction: expect.objectContaining({ status: 'blocked' }),
        })
    })

    test('a pending thread continuation replay of a fallback-labeled email never runs the project prompt', async () => {
        admin.__store.set(auditPath('m-1'), {
            threadContinuationPending: true,
            labelSource: 'fallback',
            selectedLabelKey: 'project_project_business',
            selectedGmailLabelName: 'Alldone Business',
            followUpType: 'actionable',
        })
        const gmail = buildGmail()

        const result = await processWith({ gmail })

        expect(classifyGmailMessage).not.toHaveBeenCalled()
        expect(deductGold).not.toHaveBeenCalled()
        expect(assistantHelper.collectAssistantTextWithToolCalls).not.toHaveBeenCalled()
        expect(result.goldSpent).toBe(0)
        expect(readAudit('m-1')).toMatchObject({
            threadContinuationPending: false,
            postLabelAction: expect.objectContaining({ prompt: '', status: 'skipped' }),
        })
    })

    test('a failed classification is retryable and charges nothing', async () => {
        classifyGmailMessage.mockRejectedValue(new Error('OpenAI 503'))

        const error = await processWith({ gmail: buildGmail() }).catch(caught => caught)

        expect(error).toMatchObject({
            message: 'OpenAI 503',
            gmailLabelingRetryable: true,
            gmailLabelingStage: 'classification',
        })
        expect(deductGold).not.toHaveBeenCalled()
    })

    test('a failed refund makes the label-write error final, so a retry cannot charge twice', async () => {
        classifyGmailMessage.mockResolvedValue(noMatchNotification)
        refundGold.mockRejectedValueOnce(new Error('ledger down'))
        const gmail = buildGmail()
        gmail.users.messages.modify.mockRejectedValueOnce(new Error('Gmail 500'))

        const error = await processWith({ gmail }).catch(caught => caught)

        expect(error).toMatchObject({
            message: 'Gmail 500',
            gmailLabelingRetryable: false,
            gmailLabelingStage: 'label_write_refund_failed',
        })
    })
})

describe('recordMessageProcessingError', () => {
    const retryable = message => Object.assign(new Error(message), { gmailLabelingRetryable: true })

    test('counts attempts and stops retrying at the limit', async () => {
        expect(MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS).toBe(3)
        const outcomes = []
        for (let attempt = 0; attempt < MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS; attempt++) {
            outcomes.push(
                await recordMessageProcessingError({
                    userId: USER_ID,
                    projectId: CONNECTION_KEY,
                    messageId: 'm-1',
                    rawMessage: buildRawMessage('m-1'),
                    error: retryable('Gmail 500'),
                    syncRunId: `run-${attempt}`,
                    promptVersion: 'v',
                })
            )
        }
        expect(outcomes.map(outcome => outcome.attempts)).toEqual([1, 2, 3])
        expect(outcomes.map(outcome => outcome.retryPending)).toEqual([true, true, false])
        expect(outcomes[2].retryExhausted).toBe(true)
        expect(readAudit('m-1')).toMatchObject({
            skippedReason: 'processing_error',
            processingAttempts: 3,
            processingErrorRetryPending: false,
            processingErrorRetryExhausted: true,
            reasoning: 'Gmail 500',
        })
    })

    test('an error that is not retryable is recorded once and never retried', async () => {
        const outcome = await recordMessageProcessingError({
            userId: USER_ID,
            projectId: CONNECTION_KEY,
            messageId: 'm-1',
            rawMessage: buildRawMessage('m-1'),
            error: new Error('Audit write failed after the follow-up ran'),
            syncRunId: 'run-1',
            promptVersion: 'v',
        })
        expect(outcome).toMatchObject({ attempts: 1, retryable: false, retryPending: false, retryExhausted: false })
        expect(readAudit('m-1').processingErrorRetryPending).toBe(false)
    })
})

describe('syncGmailLabeling retries failed label writes past the processed marker', () => {
    const runSync = () => syncGmailLabeling(USER_ID, CONNECTION_KEY)

    test('a processing_error marker no longer suppresses the email: the retry labels it once', async () => {
        seedSyncDocs()
        admin.__store.set(auditPath('m-failed'), {
            skippedReason: 'processing_error',
            processingAttempts: 1,
            processingErrorRetryPending: true,
        })
        // Not in the Gmail history any more: only the retry marker can bring it back.
        const gmail = buildGmail({ messages: { 'm-failed': buildRawMessage('m-failed') } })
        google.gmail.mockReturnValue(gmail)
        classifyGmailMessage.mockResolvedValue(noMatchNotification)

        const first = await runSync()

        expect(first).toMatchObject({ labeled: 1, lastError: null })
        expect(gmail.users.messages.modify).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'm-failed',
                requestBody: expect.objectContaining({ addLabelIds: [expect.any(String)] }),
            })
        )
        expect(readAudit('m-failed')).toMatchObject({
            labelSource: 'fallback',
            selectedGmailLabelName: 'Alldone Business',
            skippedReason: null,
            processingErrorRetryPending: false,
            processingAttempts: 1,
        })

        await runSync()

        // Processed once: no second classification, charge or label write.
        expect(classifyGmailMessage).toHaveBeenCalledTimes(1)
        expect(deductGold).toHaveBeenCalledTimes(1)
        expect(gmail.users.messages.modify).toHaveBeenCalledTimes(1)
    })

    test('a label write that keeps failing is retried, refunded each time and then given up visibly', async () => {
        seedSyncDocs()
        const gmail = buildGmail({
            messages: { 'm-new': buildRawMessage('m-new') },
            historyMessageIds: ['m-new'],
        })
        gmail.users.messages.modify.mockRejectedValue(new Error('Gmail 500'))
        google.gmail.mockReturnValue(gmail)
        classifyGmailMessage.mockResolvedValue({ ...noMatchNotification, emailKind: 'newsletter' })

        const results = []
        for (let run = 0; run < MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS + 1; run++) {
            results.push(await runSync())
            if (run === 0) {
                expect(readAudit('m-new')).toMatchObject({
                    skippedReason: 'processing_error',
                    processingStage: 'label_write',
                    processingAttempts: 1,
                    processingErrorRetryPending: true,
                })
            }
        }

        expect(gmail.users.messages.modify).toHaveBeenCalledTimes(MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS)
        expect(classifyGmailMessage).toHaveBeenCalledTimes(MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS)
        // Every charge was refunded: the user pays nothing for an email that never got its label.
        expect(deductGold).toHaveBeenCalledTimes(MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS)
        expect(refundGold).toHaveBeenCalledTimes(MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS)
        // No side effect ran for an email that has no label.
        expect(continueEmailThread).not.toHaveBeenCalled()
        expect(readAudit('m-new')).toMatchObject({
            processingAttempts: MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS,
            processingErrorRetryPending: false,
            processingErrorRetryExhausted: true,
        })
        expect(results[0].lastError).toBeNull()
        expect(results[MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS - 1].lastError).toMatch(
            /could not be labeled after 3 attempts/
        )
        expect(admin.__store.get(STATE_PATH).lastError).toBeNull()
        expect(results[MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS].classified).toBe(0)
    })

    test('a retry that succeeds on the second attempt labels the email and clears the marker', async () => {
        seedSyncDocs()
        const gmail = buildGmail({
            messages: { 'm-new': buildRawMessage('m-new') },
            historyMessageIds: ['m-new'],
        })
        gmail.users.messages.modify.mockRejectedValueOnce(new Error('Gmail 500'))
        google.gmail.mockReturnValue(gmail)
        classifyGmailMessage.mockResolvedValue(noMatchNotification)

        await runSync()
        const second = await runSync()

        expect(second.labeled).toBe(1)
        expect(deductGold).toHaveBeenCalledTimes(2)
        expect(refundGold).toHaveBeenCalledTimes(1)
        expect(readAudit('m-new')).toMatchObject({
            labelSource: 'fallback',
            applied: true,
            skippedReason: null,
            processingErrorRetryPending: false,
            processingAttempts: 1,
        })
    })

    test('an error after the label was written is not retried (no duplicate follow-up or charge)', async () => {
        seedSyncDocs()
        const gmail = buildGmail({
            messages: { 'm-new': buildRawMessage('m-new') },
            historyMessageIds: ['m-new'],
        })
        google.gmail.mockReturnValue(gmail)
        classifyGmailMessage.mockResolvedValue(noMatchNotification)
        // The final audit write fails once, after the label and its follow-up are done.
        let failed = false
        admin.__hooks.failSet = (path, data) => {
            if (failed || path !== auditPath('m-new') || data.labelSource !== 'fallback') return false
            failed = true
            return true
        }

        await runSync()
        await runSync()

        expect(readAudit('m-new')).toMatchObject({
            skippedReason: 'processing_error',
            processingErrorRetryPending: false,
            processingErrorRetryExhausted: false,
        })
        expect(classifyGmailMessage).toHaveBeenCalledTimes(1)
        expect(deductGold).toHaveBeenCalledTimes(1)
        expect(gmail.users.messages.modify).toHaveBeenCalledTimes(1)
    })

    test('a retry whose email can no longer be fetched uses up its attempts and ends', async () => {
        seedSyncDocs()
        admin.__store.set(auditPath('m-gone'), {
            skippedReason: 'processing_error',
            processingAttempts: 2,
            processingErrorRetryPending: true,
        })
        google.gmail.mockReturnValue(buildGmail())

        const result = await runSync()

        expect(classifyGmailMessage).not.toHaveBeenCalled()
        expect(readAudit('m-gone')).toMatchObject({
            processingStage: 'fetch',
            processingAttempts: 3,
            processingErrorRetryPending: false,
            processingErrorRetryExhausted: true,
        })
        expect(result.lastError).toMatch(/could not be labeled after 3 attempts/)
    })
})
