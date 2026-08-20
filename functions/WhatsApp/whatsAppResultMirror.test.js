// AT-2387: an assistant result delivered over WhatsApp from outside the daily topic
// (a recurring / pre-configured task, a VM job) must also land IN the daily topic,
// because that is the only thread a WhatsApp follow-up is answered from.
//
// These tests drive the REAL daily-topic module against an in-memory Firestore rather
// than mocking `storeAssistantMessageInTopicOnce`, so they exercise the actual write
// (deterministic comment id, transaction, counter increments) and then read the result
// back through `getConversationHistory` — the very function the follow-up context
// builder uses. A mocked writer would prove the mirror was *called*; it could not prove
// the result becomes available as context.

global.fetch = jest.fn()
global.AbortSignal = { timeout: jest.fn(() => undefined) }

const store = new Map()

const setFieldPath = (target, fieldPath, value) => {
    const segments = String(fieldPath).split('.')
    let cursor = target
    segments.slice(0, -1).forEach(segment => {
        if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {}
        else cursor[segment] = { ...cursor[segment] }
        cursor = cursor[segment]
    })
    const leaf = segments[segments.length - 1]
    if (value && typeof value === 'object' && typeof value.__increment === 'number') {
        cursor[leaf] = (Number(cursor[leaf]) || 0) + value.__increment
        return
    }
    cursor[leaf] = value
}

const makeSnapshot = path => ({
    id: path.split('/').pop(),
    exists: store.has(path),
    ref: mockMakeDocRef(path),
    data: () => (store.has(path) ? { ...store.get(path) } : undefined),
})

const applyUpdate = (path, data) => {
    if (!store.has(path)) {
        const error = new Error(`NOT_FOUND: ${path}`)
        error.code = 5
        throw error
    }
    const next = { ...store.get(path) }
    Object.entries(data).forEach(([key, value]) => setFieldPath(next, key, value))
    store.set(path, next)
}

function mockMakeDocRef(path) {
    return {
        path,
        id: path.split('/').pop(),
        get: jest.fn(async () => makeSnapshot(path)),
        set: jest.fn(async (data, options) => {
            store.set(path, options && options.merge ? { ...(store.get(path) || {}), ...data } : { ...data })
        }),
        update: jest.fn(async data => applyUpdate(path, data)),
    }
}

function mockMakeCollectionRef(path) {
    const state = { order: null, direction: 'asc', max: null }
    const query = {
        where: jest.fn(() => query),
        orderBy: jest.fn((field, direction = 'asc') => {
            state.order = field
            state.direction = direction
            return query
        }),
        limit: jest.fn(max => {
            state.max = max
            return query
        }),
        get: jest.fn(async () => {
            let docs = [...store.keys()]
                .filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
                .map(makeSnapshot)
            if (state.order) {
                docs.sort((left, right) => {
                    const leftValue = Number(left.data()[state.order]) || 0
                    const rightValue = Number(right.data()[state.order]) || 0
                    return state.direction === 'desc' ? rightValue - leftValue : leftValue - rightValue
                })
            }
            if (state.max) docs = docs.slice(0, state.max)
            return { docs, empty: docs.length === 0, size: docs.length }
        }),
    }
    return query
}

const mockRunTransaction = jest.fn(async handler => {
    const writes = []
    await handler({
        get: async ref => makeSnapshot(ref.path),
        set: (ref, data) => writes.push(() => store.set(ref.path, { ...data })),
        update: (ref, data) => writes.push(() => applyUpdate(ref.path, data)),
    })
    writes.forEach(write => write())
})

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: jest.fn(path => mockMakeDocRef(path)),
        collection: jest.fn(path => mockMakeCollectionRef(path)),
        runTransaction: (...args) => mockRunTransaction(...args),
    })),
}))

jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { increment: value => ({ __increment: value }) },
    Timestamp: { now: () => ({ __timestamp: true }) },
}))

jest.mock('openai', () => jest.fn())
jest.mock(
    '@dqbd/tiktoken/lite',
    () => ({ Tiktoken: jest.fn().mockImplementation(() => ({ encode: jest.fn(() => []), free: jest.fn() })) }),
    { virtual: true }
)
jest.mock('@dqbd/tiktoken/encoders/cl100k_base.json', () => ({ bpe_ranks: {}, special_tokens: {}, pat_str: '' }), {
    virtual: true,
})
jest.mock('firebase-functions/params', () => ({ defineString: jest.fn(() => ({ value: jest.fn(() => '') })) }), {
    virtual: true,
})

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 'all',
    STAYWARD_COMMENT: 'comment',
}))

const mockGetUserData = jest.fn()
jest.mock('../Users/usersFirestore', () => ({
    getUserData: (...args) => mockGetUserData(...args),
}))

const { mirrorAssistantResultToWhatsAppDailyTopic, buildMirrorCommentId } = require('./whatsAppResultMirror')
const { getConversationHistory } = require('./whatsAppDailyTopic')

const USER = {
    uid: 'user-1',
    displayName: 'Karsten Wysk',
    defaultProjectId: 'whatsapp-project',
    timezone: 0,
}

// 2026-08-20T09:00:00Z — the user's local day is UTC here, so the topic id is stable.
const RUN_AT = Date.UTC(2026, 7, 20, 9, 0, 0)
const DAILY_TOPIC_ID = 'BotChat20260820user-1'
const DAILY_TOPIC_PATH = `chatObjects/whatsapp-project/chats/${DAILY_TOPIC_ID}`
const DAILY_COMMENTS_PATH = `chatComments/whatsapp-project/topics/${DAILY_TOPIC_ID}/comments`

const listDailyComments = () =>
    [...store.entries()]
        .filter(([key]) => key.startsWith(`${DAILY_COMMENTS_PATH}/`))
        .map(([key, value]) => ({ id: key.split('/').pop(), ...value }))

const scheduledTaskDelivery = (overrides = {}) => ({
    userId: 'user-1',
    assistantId: 'assistant-1',
    resultText: 'Tech is up 2.3% today. AAPL +1.8%, GOOGL +2.1%.',
    sourceProjectId: 'work-project',
    sourceObjectId: 'generated-task-1',
    sourceObjectType: 'tasks',
    sourceCommentId: 'comment-1',
    userData: USER,
    timestamp: RUN_AT,
    ...overrides,
})

describe('mirrorAssistantResultToWhatsAppDailyTopic', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        store.clear()
        mockGetUserData.mockResolvedValue(USER)
    })

    test('a scheduled task result becomes available as follow-up context in the daily topic', async () => {
        const result = await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery())

        expect(result).toEqual(
            expect.objectContaining({
                mirrored: true,
                reason: 'stored',
                projectId: 'whatsapp-project',
                chatId: DAILY_TOPIC_ID,
            })
        )

        // The canonical daily topic was created, not some parallel record.
        expect(store.get(DAILY_TOPIC_PATH)).toEqual(
            expect.objectContaining({ id: DAILY_TOPIC_ID, type: 'topics', isAssistantEnabled: true })
        )

        // And the follow-up context builder sees the result as an assistant turn.
        const history = await getConversationHistory('whatsapp-project', DAILY_TOPIC_ID, 20, 0)
        expect(history).toEqual([['assistant', 'Tech is up 2.3% today. AAPL +1.8%, GOOGL +2.1%.']])
    })

    test('stores exactly one comment, credited to the assistant, tagged with its origin', async () => {
        await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery())

        const comments = listDailyComments()
        expect(comments).toHaveLength(1)
        expect(comments[0]).toEqual(
            expect.objectContaining({
                creatorId: 'assistant-1',
                fromAssistant: true,
                source: 'whatsapp',
                isWhatsAppResultMirror: true,
                mirroredFrom: {
                    projectId: 'work-project',
                    objectType: 'tasks',
                    objectId: 'generated-task-1',
                    commentId: 'comment-1',
                },
            })
        )
        expect(store.get(DAILY_TOPIC_PATH).commentsData.amount).toBe(1)
    })

    test('a redelivered result does not post a second topic message', async () => {
        const first = await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery())
        const second = await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery())

        expect(first.mirrored).toBe(true)
        expect(second).toEqual(expect.objectContaining({ mirrored: false, reason: 'duplicate' }))
        expect(second.commentId).toBe(first.commentId)
        expect(listDailyComments()).toHaveLength(1)
        // A duplicate must not double-count the chat's comment counter either.
        expect(store.get(DAILY_TOPIC_PATH).commentsData.amount).toBe(1)
    })

    test('a different result from the same task still gets its own message', async () => {
        await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery())
        await mirrorAssistantResultToWhatsAppDailyTopic(
            scheduledTaskDelivery({ sourceCommentId: 'comment-2', resultText: 'Second run of the day.' })
        )

        expect(listDailyComments()).toHaveLength(2)
        expect(store.get(DAILY_TOPIC_PATH).commentsData.amount).toBe(2)
    })

    test('falls back to hashing the result text when the source has no comment id', async () => {
        const delivery = scheduledTaskDelivery({ sourceCommentId: null })

        const first = await mirrorAssistantResultToWhatsAppDailyTopic(delivery)
        const second = await mirrorAssistantResultToWhatsAppDailyTopic(delivery)

        expect(first.mirrored).toBe(true)
        expect(second.mirrored).toBe(false)
        expect(listDailyComments()).toHaveLength(1)
    })

    test('uses the daily topic of the user default project, not the project the task ran in', async () => {
        await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery())

        expect(store.has(DAILY_TOPIC_PATH)).toBe(true)
        expect([...store.keys()].some(key => key.startsWith('chatObjects/work-project/'))).toBe(false)
    })

    test('reads the user doc itself when the caller has none', async () => {
        await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery({ userData: null }))

        expect(mockGetUserData).toHaveBeenCalledWith('user-1')
        expect(listDailyComments()).toHaveLength(1)
    })

    test('stays silent: it never moves the MyDay AssistantLine pointer', async () => {
        await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery())

        expect(store.has('users/user-1')).toBe(false)
    })

    test('skips the heartbeat, whose answer already runs inside the daily topic', async () => {
        const result = await mirrorAssistantResultToWhatsAppDailyTopic(
            scheduledTaskDelivery({
                sourceProjectId: 'whatsapp-project',
                sourceObjectId: DAILY_TOPIC_ID,
                sourceObjectType: 'topics',
            })
        )

        expect(result).toEqual(expect.objectContaining({ mirrored: false, reason: 'source_is_daily_topic' }))
        expect(listDailyComments()).toHaveLength(0)
    })

    test('skips a conversation that already received the result through another path', async () => {
        const result = await mirrorAssistantResultToWhatsAppDailyTopic(
            scheduledTaskDelivery({
                alreadyDeliveredTo: [{ projectId: 'whatsapp-project', objectId: DAILY_TOPIC_ID }],
            })
        )

        expect(result).toEqual(expect.objectContaining({ mirrored: false, reason: 'already_delivered' }))
        expect(listDailyComments()).toHaveLength(0)
    })

    test('ignores an empty result and a missing user instead of writing a blank message', async () => {
        await expect(
            mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery({ resultText: '   ' }))
        ).resolves.toEqual({ mirrored: false, reason: 'empty_result' })
        await expect(mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery({ userId: '' }))).resolves.toEqual(
            {
                mirrored: false,
                reason: 'missing_user',
            }
        )
        expect(listDailyComments()).toHaveLength(0)
    })

    test('never throws when the topic write fails — the WhatsApp message already went out', async () => {
        mockRunTransaction.mockRejectedValueOnce(new Error('firestore unavailable'))

        await expect(mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery())).resolves.toEqual({
            mirrored: false,
            reason: 'error',
        })
    })

    test('falls back to the source project when the user has no default project', async () => {
        mockGetUserData.mockResolvedValue({ uid: 'user-1', displayName: 'Karsten', timezone: 0 })

        const result = await mirrorAssistantResultToWhatsAppDailyTopic(scheduledTaskDelivery({ userData: null }))

        expect(result).toEqual(expect.objectContaining({ mirrored: true, projectId: 'work-project' }))
    })
})

describe('buildMirrorCommentId', () => {
    const base = {
        projectId: 'whatsapp-project',
        chatId: DAILY_TOPIC_ID,
        sourceProjectId: 'work-project',
        sourceObjectType: 'tasks',
        sourceObjectId: 'generated-task-1',
        sourceCommentId: 'comment-1',
        resultText: 'Result',
    }

    test('is deterministic for the same source delivery', () => {
        expect(buildMirrorCommentId(base)).toBe(buildMirrorCommentId(base))
        expect(buildMirrorCommentId(base)).toMatch(/^wa-mirror-[0-9a-f]{40}$/)
    })

    test('differs per source delivery and per destination topic', () => {
        expect(buildMirrorCommentId({ ...base, sourceCommentId: 'comment-2' })).not.toBe(buildMirrorCommentId(base))
        // Tomorrow's topic is a different conversation, so the same result may be mirrored again.
        expect(buildMirrorCommentId({ ...base, chatId: 'BotChat20260821user-1' })).not.toBe(buildMirrorCommentId(base))
    })
})
