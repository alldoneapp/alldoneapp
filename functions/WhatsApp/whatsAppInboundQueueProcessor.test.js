jest.mock('firebase-admin', () => {
    const batchApi = {
        update: jest.fn(),
        delete: jest.fn(),
        commit: jest.fn(async () => {}),
    }

    return {
        firestore: jest.fn(() => ({
            batch: jest.fn(() => batchApi),
        })),
    }
})

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        sendWhatsAppMessage: jest.fn(async () => {}),
    }))
)

jest.mock('./whatsAppDailyTopic', () => ({
    getOrCreateWhatsAppDailyTopic: jest.fn(),
    storeUserMessageInTopic: jest.fn(),
}))

jest.mock('./whatsAppAssistantBridge', () => ({
    processWhatsAppAssistantMessage: jest.fn(),
}))

const { getOrCreateWhatsAppDailyTopic, storeUserMessageInTopic } = require('./whatsAppDailyTopic')
const { processWhatsAppAssistantMessage } = require('./whatsAppAssistantBridge')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const admin = require('firebase-admin')
const {
    processBatchForUser,
    processWhatsAppInboundQueueItem,
    isTransientAssistantError,
    recoverStalledProcessingItems,
    STALLED_PROCESSING_TIMEOUT_MS,
} = require('./whatsAppInboundQueueProcessor')
const { WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('../Assistant/assistantRunLimits')
const { WHATSAPP_TIMEOUT_CODE } = require('./whatsAppRunGuard')

describe('WhatsApp inbound queue processor', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getOrCreateWhatsAppDailyTopic.mockResolvedValue({ chatId: 'chat-1' })
        storeUserMessageInTopic.mockResolvedValue('comment-1')
        processWhatsAppAssistantMessage.mockResolvedValue('Processed')
    })

    afterEach(() => jest.useRealTimers())

    test('uses the last stored user message as the triggering WhatsApp message', async () => {
        storeUserMessageInTopic.mockResolvedValueOnce('comment-1').mockResolvedValueOnce('comment-2')

        await processBatchForUser('user-1', [
            {
                id: 'queue-1',
                createdAt: 1,
                fromNumber: 'whatsapp:+123',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageText: 'first',
                storedMessageText: 'first',
                processedMedia: [],
            },
            {
                id: 'queue-2',
                createdAt: 2,
                fromNumber: 'whatsapp:+123',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageText: 'second',
                storedMessageText: 'second',
                processedMedia: [],
                replyContext: {
                    messageSid: 'SMoriginal',
                    sender: 'whatsapp:+123',
                    text: 'Original message',
                    hasMedia: false,
                    resolved: true,
                },
            },
        ])

        expect(storeUserMessageInTopic).toHaveBeenCalledTimes(2)
        expect(storeUserMessageInTopic).toHaveBeenLastCalledWith(
            'project-1',
            'chat-1',
            'user-1',
            'second',
            false,
            expect.objectContaining({
                replyContext: expect.objectContaining({
                    messageSid: 'SMoriginal',
                    text: 'Original message',
                }),
            })
        )
        expect(processWhatsAppAssistantMessage).toHaveBeenCalledWith(
            'user-1',
            'project-1',
            'chat-1',
            'first\n\nsecond',
            'assistant-1',
            null,
            expect.objectContaining({
                skipCurrentMessageAppend: true,
                messageId: 'comment-2',
                whatsappFromNumber: 'whatsapp:+123',
            })
        )

        const whatsappService = TwilioWhatsAppService.mock.results[0].value
        expect(whatsappService.sendWhatsAppMessage).toHaveBeenCalledWith('whatsapp:+123', 'Processed', {
            projectId: 'project-1',
            objectId: 'chat-1',
            objectType: 'topics',
        })
    })

    test('retries transient assistant upstream errors before sending WhatsApp response', async () => {
        jest.useFakeTimers()

        processWhatsAppAssistantMessage
            .mockRejectedValueOnce(
                new Error(
                    '503 upstream connect error or disconnect/reset before headers. reset reason: connection termination'
                )
            )
            .mockResolvedValueOnce('Recovered')

        const processing = processBatchForUser('user-1', [
            {
                id: 'queue-1',
                ref: { path: 'queue-1' },
                createdAt: 1,
                fromNumber: 'whatsapp:+123',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageText: 'retry me',
                storedMessageText: 'retry me',
                processedMedia: [],
            },
        ])

        await jest.advanceTimersByTimeAsync(1000)
        await processing

        expect(processWhatsAppAssistantMessage).toHaveBeenCalledTimes(2)

        const whatsappService = TwilioWhatsAppService.mock.results[0].value
        expect(whatsappService.sendWhatsAppMessage).toHaveBeenCalledWith('whatsapp:+123', 'Recovered', {
            projectId: 'project-1',
            objectId: 'chat-1',
            objectType: 'topics',
        })
    })

    const queueItem = () => ({
        id: 'queue-timeout',
        ref: { path: 'queue-timeout' },
        createdAt: 1,
        fromNumber: 'whatsapp:+123',
        projectId: 'project-1',
        assistantId: 'assistant-1',
        messageText: 'Wie alt ist Adriana Lima?',
        language: 'de',
    })

    test('aborts a stalled assistant, marks failure, and sends one localized WhatsApp error', async () => {
        jest.useFakeTimers()
        let finishLate
        processWhatsAppAssistantMessage.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishLate = resolve
                })
        )
        const item = queueItem()
        const processing = processBatchForUser('user-1', [item])
        await jest.advanceTimersByTimeAsync(WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS)
        await processing
        const guard = processWhatsAppAssistantMessage.mock.calls[0][6].runGuard
        expect(guard.signal.aborted).toBe(true)
        expect(admin.firestore().batch().update).toHaveBeenCalledWith(
            item.ref,
            expect.objectContaining({
                status: 'failed',
                lastErrorCode: WHATSAPP_TIMEOUT_CODE,
            })
        )
        const send = TwilioWhatsAppService.mock.results[0].value.sendWhatsAppMessage
        expect(send).toHaveBeenCalledTimes(1)
        expect(send).toHaveBeenCalledWith('whatsapp:+123', expect.stringContaining('zu lange gedauert'))
        finishLate('Late response must never be delivered')
        await jest.advanceTimersByTimeAsync(10000)
        expect(TwilioWhatsAppService).toHaveBeenCalledTimes(1)
        expect(processWhatsAppAssistantMessage).toHaveBeenCalledTimes(1)
        expect(admin.firestore().batch().delete).not.toHaveBeenCalled()
        expect(jest.getTimerCount()).toBe(0)
    })

    test('also bounds context loading, preventing late user messages or AI requests', async () => {
        jest.useFakeTimers()
        let finishLate
        getOrCreateWhatsAppDailyTopic.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishLate = resolve
                })
        )
        const processing = processBatchForUser('user-1', [queueItem()])
        await jest.advanceTimersByTimeAsync(WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS)
        await processing
        finishLate({ chatId: 'chat-1' })
        await jest.advanceTimersByTimeAsync(0)
        expect(storeUserMessageInTopic).not.toHaveBeenCalled()
        expect(processWhatsAppAssistantMessage).not.toHaveBeenCalled()
        expect(TwilioWhatsAppService).toHaveBeenCalledTimes(1)
    })

    test('does not replay an assistant after a tool has started even when it throws a transient error', async () => {
        processWhatsAppAssistantMessage.mockImplementationOnce(async (...args) => {
            args[6].runGuard.markToolStarted()
            throw Object.assign(new Error('upstream failed'), { status: 503 })
        })
        await processBatchForUser('user-1', [queueItem()])
        expect(processWhatsAppAssistantMessage).toHaveBeenCalledTimes(1)
        expect(TwilioWhatsAppService.mock.results[0].value.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
    })

    test('does not retry non-transient assistant errors', async () => {
        processWhatsAppAssistantMessage.mockRejectedValueOnce(new Error('Invalid tool arguments'))

        await processBatchForUser('user-1', [
            {
                id: 'queue-1',
                ref: { path: 'queue-1' },
                createdAt: 1,
                fromNumber: 'whatsapp:+123',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageText: 'bad request',
                storedMessageText: 'bad request',
                processedMedia: [],
            },
        ])

        expect(processWhatsAppAssistantMessage).toHaveBeenCalledTimes(1)

        const whatsappService = TwilioWhatsAppService.mock.results[0].value
        expect(whatsappService.sendWhatsAppMessage).toHaveBeenCalledWith(
            'whatsapp:+123',
            'Sorry, I encountered an error. Please try again later.'
        )
    })

    test('classifies upstream connection resets as transient assistant errors', () => {
        expect(
            isTransientAssistantError(
                new Error(
                    '503 upstream connect error or disconnect/reset before headers. reset reason: connection termination'
                )
            )
        ).toBe(true)
        expect(isTransientAssistantError(Object.assign(new Error('temporarily unavailable'), { status: 503 }))).toBe(
            true
        )
        expect(isTransientAssistantError(new Error('Invalid tool arguments'))).toBe(false)
    })
})

describe('interrupted WhatsApp recovery', () => {
    let defaultFirestore
    beforeEach(() => {
        defaultFirestore = admin.firestore.getMockImplementation()
        jest.clearAllMocks()
    })
    afterEach(() => admin.firestore.mockImplementation(defaultFirestore))

    function prepareRecovery({
        ownerId = 'owner',
        status = 'processing',
        age = STALLED_PROCESSING_TIMEOUT_MS + 1,
    } = {}) {
        const data = { status, processingStartedAt: Date.now() - age, fromNumber: 'whatsapp:+123', language: 'de' }
        const snapshot = { id: 'stalled', ref: { path: 'stalled' }, exists: true, data: () => data }
        const tx = { getAll: jest.fn(async () => [{ data: () => ({ ownerId }) }, snapshot]), update: jest.fn() }
        const query = {
            where: jest.fn(() => query),
            limit: jest.fn(() => query),
            get: jest.fn(async () => ({ docs: [snapshot] })),
        }
        admin.firestore.mockReturnValue({
            collection: jest.fn(() => query),
            doc: jest.fn(path => ({ path })),
            runTransaction: jest.fn(async operation => operation(tx)),
        })
        return { tx, snapshot, data }
    }

    test('a queue drain releases its lock after an assistant stalls and preserves the failed item', async () => {
        jest.useFakeTimers()
        const itemPath = 'whatsAppInboundQueue/user-1/items/stalled'
        const lockPath = 'whatsAppInboundLocks/user-1'
        const records = new Map([
            [
                itemPath,
                {
                    status: 'pending',
                    createdAt: Date.now() - 5000,
                    messageText: 'How old is Adriana Lima?',
                    fromNumber: 'whatsapp:+123',
                    projectId: 'project-1',
                    assistantId: 'assistant-1',
                },
            ],
        ])
        const docRef = path => ({ path, id: path.split('/').at(-1) })
        const snapshot = ref => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => records.get(ref.path) })
        const tx = {
            get: async ref => snapshot(ref),
            getAll: async (...refs) => refs.map(snapshot),
            set: (ref, data) => records.set(ref.path, data),
            update: (ref, data) => records.set(ref.path, { ...records.get(ref.path), ...data }),
            delete: ref => records.delete(ref.path),
        }
        const db = {
            doc: docRef,
            runTransaction: async operation => operation(tx),
            collection: path => {
                let status
                const query = {
                    where: (field, op, value) => {
                        status = value
                        return query
                    },
                    orderBy: () => query,
                    limit: () => query,
                    get: async () => ({
                        docs: [...records.keys()]
                            .filter(key => key.startsWith(path + '/') && records.get(key).status === status)
                            .map(key => snapshot(docRef(key))),
                    }),
                }
                return query
            },
            batch: () => ({ update: tx.update, delete: tx.delete, commit: async () => {} }),
        }
        admin.firestore.mockReturnValue(db)
        getOrCreateWhatsAppDailyTopic.mockResolvedValue({ chatId: 'chat-1' })
        storeUserMessageInTopic.mockResolvedValue('comment-1')
        processWhatsAppAssistantMessage.mockImplementationOnce(() => new Promise(() => {}))
        try {
            const drain = processWhatsAppInboundQueueItem({ params: { userId: 'user-1' } })
            await jest.advanceTimersByTimeAsync(0)
            expect(records.has(lockPath)).toBe(true)
            expect(records.get(itemPath).status).toBe('processing')
            await jest.advanceTimersByTimeAsync(WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS)
            await drain
            expect(records.has(lockPath)).toBe(false)
            expect(records.get(itemPath)).toMatchObject({ status: 'failed', lastErrorCode: WHATSAPP_TIMEOUT_CODE })
            expect(TwilioWhatsAppService.mock.results[0].value.sendWhatsAppMessage).toHaveBeenCalledTimes(1)
            expect(jest.getTimerCount()).toBe(0)
        } finally {
            jest.useRealTimers()
        }
    })

    test('settles an abandoned processing item and notifies without replaying its actions', async () => {
        const { tx, snapshot } = prepareRecovery()
        await recoverStalledProcessingItems('user-1', 'owner')
        expect(tx.update).toHaveBeenCalledWith(
            snapshot.ref,
            expect.objectContaining({ status: 'failed', lastErrorCode: WHATSAPP_TIMEOUT_CODE })
        )
        expect(TwilioWhatsAppService.mock.results[0].value.sendWhatsAppMessage).toHaveBeenCalledWith(
            'whatsapp:+123',
            expect.stringContaining('unterbrochen')
        )
        expect(processWhatsAppAssistantMessage).not.toHaveBeenCalled()
    })

    test.each([{ age: 1000 }, { ownerId: 'new-owner' }, { status: 'failed' }])(
        'does not recover active, settled, or differently owned work: %j',
        async options => {
            const { tx } = prepareRecovery(options)
            await recoverStalledProcessingItems('user-1', 'owner')
            expect(tx.update).not.toHaveBeenCalled()
            expect(TwilioWhatsAppService).not.toHaveBeenCalled()
        }
    )
})
