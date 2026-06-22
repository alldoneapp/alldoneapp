const mockGeneratePreConfigTaskResult = jest.fn()
const mockHasUserMessageOnUserLocalDay = jest.fn()
const mockCreateInitialStatusMessage = jest.fn()
const mockGetOpenTasksContextMessage = jest.fn()
const mockSendWhatsAppMessage = jest.fn()
let mockDocs = new Map()

const NOTICE_MESSAGE =
    'Heartbeat paused because you\u2019re out of gold. Add gold to resume assistant heartbeats here https://my.alldone.app/settings/premium'

function mockClone(value) {
    return JSON.parse(JSON.stringify(value))
}

function mockApplyValue(previousValue, nextValue) {
    if (nextValue && typeof nextValue === 'object' && nextValue.__arrayUnion) {
        const values = Array.isArray(previousValue) ? previousValue : []
        return Array.from(new Set([...values, ...nextValue.values]))
    }

    return nextValue
}

function mockApplyWrite(path, data, options = {}) {
    const previousDoc = mockDocs.has(path) ? mockDocs.get(path) : {}
    const nextDoc = options.merge ? { ...previousDoc } : {}

    Object.keys(data).forEach(key => {
        nextDoc[key] = mockApplyValue(previousDoc[key], data[key])
    })

    mockDocs.set(path, nextDoc)
}

function mockDocSnapshot(path) {
    return {
        id: path.split('/').pop(),
        exists: mockDocs.has(path),
        data: () => mockClone(mockDocs.get(path) || {}),
    }
}

function mockQueryDocsForPath(path) {
    const prefix = `${path}/`
    return Array.from(mockDocs.entries())
        .filter(([docPath]) => docPath.startsWith(prefix) && !docPath.slice(prefix.length).includes('/'))
        .map(([docPath]) => mockDocSnapshot(docPath))
}

function mockBuildDocRef(path) {
    return {
        path,
        get: jest.fn(async () => mockDocSnapshot(path)),
        set: jest.fn(async (data, options) => mockApplyWrite(path, data, options)),
        update: jest.fn(async data => mockApplyWrite(path, data, { merge: true })),
    }
}

function mockBuildCollectionRef(path) {
    const query = {
        where: jest.fn(() => query),
        orderBy: jest.fn(() => query),
        limit: jest.fn(() => query),
        get: jest.fn(async () => ({
            docs: mockQueryDocsForPath(path),
            empty: mockQueryDocsForPath(path).length === 0,
        })),
    }
    return query
}

jest.mock('firebase-admin', () => {
    const runTransaction = jest.fn(async callback => {
        const transaction = {
            get: jest.fn(async ref => mockDocSnapshot(ref.path)),
            set: jest.fn((ref, data, options) => mockApplyWrite(ref.path, data, options)),
            update: jest.fn((ref, data) => mockApplyWrite(ref.path, data, { merge: true })),
        }

        return await callback(transaction)
    })

    return {
        firestore: Object.assign(
            jest.fn(() => ({
                doc: mockBuildDocRef,
                collection: mockBuildCollectionRef,
                runTransaction,
            })),
            {
                FieldValue: {
                    arrayUnion: jest.fn((...values) => ({ __arrayUnion: true, values })),
                },
            }
        ),
        __mock: {
            reset() {
                mockDocs = new Map()
                runTransaction.mockClear()
            },
            setDoc(path, data) {
                mockDocs.set(path, mockClone(data))
            },
            getDoc(path) {
                return mockDocs.get(path)
            },
        },
    }
})

jest.mock('./assistantPreConfigTaskTopic', () => ({
    generatePreConfigTaskResult: (...args) => mockGeneratePreConfigTaskResult(...args),
    hasUserMessageOnUserLocalDay: (...args) => mockHasUserMessageOnUserLocalDay(...args),
}))

jest.mock('./assistantStatusHelper', () => ({
    createInitialStatusMessage: (...args) => mockCreateInitialStatusMessage(...args),
}))

jest.mock('./assistantHelper', () => ({
    getOpenTasksContextMessage: (...args) => mockGetOpenTasksContextMessage(...args),
    parseTextForUseLiKePrompt: text => text,
}))

jest.mock('./contextTimestampHelper', () => ({
    addTimestampToContextContent: content => content,
    resolveUserTimezoneOffset: jest.fn(() => 0),
    getUserLocalDayBounds: jest.fn(() => ({ startOfDay: 999000000, endOfDay: 1001000000 })),
    getUserLocalDateContext: jest.fn(() => ({ dateKey: '20260504', dateLabel: 'May 4' })),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 'FEED_PUBLIC_FOR_ALL',
    getFirstName: name => String(name || '').split(' ')[0],
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(async userId => ({ uid: userId, displayName: 'Test User' })),
}))

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        sendWhatsAppMessage: (...args) => mockSendWhatsAppMessage(...args),
    }))
)

const admin = require('firebase-admin')
const { checkAndExecuteHeartbeats } = require('./assistantHeartbeat')

describe('assistant heartbeat insufficient gold notice', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        admin.__mock.reset()
        jest.spyOn(Date, 'now').mockReturnValue(1000000000)
        jest.spyOn(Math, 'random').mockReturnValue(0.99)
        mockHasUserMessageOnUserLocalDay.mockResolvedValue(true)

        admin.__mock.setDoc('users/user-1', {
            uid: 'user-1',
            displayName: 'Test User',
            lastLogin: 1000000000,
            gold: 0,
            phone: '+1234567890',
        })
        admin.__mock.setDoc('projects/project-1', {
            active: true,
            userIds: ['user-1'],
        })
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            uid: 'assistant-1',
            heartbeatPrompt: 'Check in.',
            heartbeatChancePercent: 1,
            heartbeatAwakeStart: 0,
            heartbeatAwakeEnd: 86340000,
            heartbeatIntervalMs: 300000,
            heartbeatSendWhatsApp: true,
            model: 'MODEL_GPT5_5',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: 'Be helpful.',
        })
    })

    afterEach(() => {
        Date.now.mockRestore()
        Math.random.mockRestore()
    })

    test('sends a throttled WhatsApp notice before the heartbeat chance roll', async () => {
        mockSendWhatsAppMessage.mockResolvedValue({ success: true })

        await checkAndExecuteHeartbeats()

        expect(mockSendWhatsAppMessage).toHaveBeenCalledWith('+1234567890', NOTICE_MESSAGE)
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(admin.__mock.getDoc('users/user-1').heartbeatInsufficientGoldNoticeAt).toBe(1000000000)
    })

    test('does not send another notice inside the throttle window', async () => {
        admin.__mock.setDoc('users/user-1', {
            ...admin.__mock.getDoc('users/user-1'),
            heartbeatInsufficientGoldNoticeAt: 999999000,
        })

        await checkAndExecuteHeartbeats()

        expect(mockSendWhatsAppMessage).not.toHaveBeenCalled()
        expect(mockCreateInitialStatusMessage).not.toHaveBeenCalled()
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
    })

    test('falls back to an in-app heartbeat topic notice when WhatsApp fails', async () => {
        mockSendWhatsAppMessage.mockResolvedValue({ success: false, error: 'Outside WhatsApp session' })

        await checkAndExecuteHeartbeats()

        expect(mockCreateInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'Heartbeat20260504user-1',
            'assistant-1',
            NOTICE_MESSAGE,
            ['user-1'],
            ['FEED_PUBLIC_FOR_ALL'],
            ['user-1']
        )
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
    })

    test('records guardrail failures for the heartbeat status section', async () => {
        admin.__mock.setDoc('users/user-1', {
            ...admin.__mock.getDoc('users/user-1'),
            gold: 10,
        })
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatChancePercent: 100,
            heartbeatSendWhatsApp: false,
        })
        mockGeneratePreConfigTaskResult.mockResolvedValue({
            success: true,
            silentOk: false,
            commentId: 'comment-1',
            commentText:
                '⚠️ Stopped: this run reached its time limit before finishing. Please narrow the request or try again.',
            guardrailStopped: {
                reason: 'time_budget',
                message:
                    '⚠️ Stopped: this run reached its time limit before finishing. Please narrow the request or try again.',
            },
        })

        await checkAndExecuteHeartbeats()

        const assistantDoc = admin.__mock.getDoc('assistants/project-1/items/assistant-1')
        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledWith(
            'user-1',
            'project-1',
            expect.stringMatching(/^Heartbeat/),
            ['user-1'],
            ['FEED_PUBLIC_FOR_ALL'],
            'assistant-1',
            'Check in.',
            'en',
            expect.any(Object),
            { sendWhatsApp: false, name: 'Heartbeat', recurrence: 'never' },
            null,
            'topics',
            expect.objectContaining({ silentModeMarker: 'HEARTBEAT_OK' })
        )
        expect(assistantDoc['heartbeatLastFailureByUser.user-1']).toBe(1000000000)
        expect(assistantDoc['heartbeatLastFailureMessageByUser.user-1']).toBe(
            '⚠️ Stopped: this run reached its time limit before finishing. Please narrow the request or try again.'
        )
        expect(assistantDoc['heartbeatLastExecutedByUser.user-1']).toBeUndefined()
    })
})

describe('assistant heartbeat reply-aware execution chance', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        admin.__mock.reset()
        jest.spyOn(Date, 'now').mockReturnValue(1000000000)
        // Random roll of 0.5 -> 50, so a 100% chance executes and a 0% chance does not.
        jest.spyOn(Math, 'random').mockReturnValue(0.5)
        mockGeneratePreConfigTaskResult.mockResolvedValue({ success: true, silentOk: false, commentId: 'comment-1' })

        admin.__mock.setDoc('users/user-1', {
            uid: 'user-1',
            displayName: 'Test User',
            lastLogin: 1000000000,
            gold: 100,
        })
        admin.__mock.setDoc('projects/project-1', {
            active: true,
            userIds: ['user-1'],
        })
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            uid: 'assistant-1',
            heartbeatPrompt: 'Check in.',
            heartbeatChancePercent: 100,
            heartbeatChanceNoReplyPercent: 0,
            heartbeatAwakeStart: 0,
            heartbeatAwakeEnd: 86340000,
            heartbeatIntervalMs: 300000,
            heartbeatSendWhatsApp: false,
            model: 'MODEL_GPT5_5',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: 'Be helpful.',
        })
    })

    afterEach(() => {
        Date.now.mockRestore()
        Math.random.mockRestore()
    })

    test('uses the higher chance for the first completed heartbeat even before the user replies', async () => {
        mockHasUserMessageOnUserLocalDay.mockResolvedValue(false)

        await checkAndExecuteHeartbeats()

        expect(mockHasUserMessageOnUserLocalDay).not.toHaveBeenCalled()
        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
    })

    test('resets to the higher chance on the next local day', async () => {
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatLastExecutedByUser: { 'user-1': 998500000 },
        })
        mockHasUserMessageOnUserLocalDay.mockResolvedValue(false)

        await checkAndExecuteHeartbeats()

        expect(mockHasUserMessageOnUserLocalDay).not.toHaveBeenCalled()
        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
    })

    test('uses the replied chance after an earlier heartbeat when the user replied that day', async () => {
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatLastExecutedByUser: { 'user-1': 999500000 },
        })
        mockHasUserMessageOnUserLocalDay.mockResolvedValue(true)

        await checkAndExecuteHeartbeats()

        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
    })

    test('uses the no-reply chance after an earlier heartbeat when the user has not replied', async () => {
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatLastExecutedByUser: { 'user-1': 999500000 },
        })
        mockHasUserMessageOnUserLocalDay.mockResolvedValue(false)

        await checkAndExecuteHeartbeats()

        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
    })

    test('keeps using the higher chance after a silent OK', async () => {
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatLastSilentOkByUser: { 'user-1': 999500000 },
        })
        mockHasUserMessageOnUserLocalDay.mockResolvedValue(false)

        await checkAndExecuteHeartbeats()

        expect(mockHasUserMessageOnUserLocalDay).not.toHaveBeenCalled()
        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
    })

    test('honors a no-reply chance higher than the replied chance', async () => {
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatChancePercent: 0,
            heartbeatChanceNoReplyPercent: 100,
            heartbeatLastExecutedByUser: { 'user-1': 999500000 },
        })
        mockHasUserMessageOnUserLocalDay.mockResolvedValue(false)

        await checkAndExecuteHeartbeats()

        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
    })

    test('does not query reply state when both chances are equal', async () => {
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatChancePercent: 100,
            heartbeatChanceNoReplyPercent: 100,
        })

        await checkAndExecuteHeartbeats()

        expect(mockHasUserMessageOnUserLocalDay).not.toHaveBeenCalled()
        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
    })
})
