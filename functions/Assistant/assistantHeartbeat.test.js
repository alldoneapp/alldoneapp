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
    resolveUserTimezoneName: jest.fn(() => null),
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
const { checkAndExecuteHeartbeats, executeScheduledHeartbeat } = require('./assistantHeartbeat')
const { getHeartbeatScheduleId, getHeartbeatScheduleTiming } = require('./assistantHeartbeatSchedule')

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

describe('scheduled assistant heartbeat worker', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        admin.__mock.reset()
        jest.spyOn(Date, 'now').mockReturnValue(1000000000)
        jest.spyOn(Math, 'random').mockReturnValue(0.1)
        mockGeneratePreConfigTaskResult.mockResolvedValue({
            success: true,
            silentOk: false,
            commentId: 'comment-1',
            commentText: 'Heartbeat result',
        })

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
            heartbeatChanceNoReplyPercent: 100,
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

    function seedSchedule() {
        const assistant = { uid: 'assistant-1', ...admin.__mock.getDoc('assistants/project-1/items/assistant-1') }
        const user = admin.__mock.getDoc('users/user-1')
        const timing = getHeartbeatScheduleTiming(assistant, user)
        const scheduleId = getHeartbeatScheduleId('project-1', 'assistant-1', 'user-1')
        admin.__mock.setDoc(`assistantHeartbeatSchedules/${scheduleId}`, {
            projectId: 'project-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            nextHeartbeatAt: 1000000000,
            ...timing,
            createdAt: 999000000,
            updatedAt: 999000000,
        })
        return { scheduleId, scheduleHash: timing.scheduleHash }
    }

    test('claims and executes an occurrence at most once', async () => {
        const { scheduleId, scheduleHash } = seedSchedule()
        const payload = {
            scheduleId,
            scheduleHash,
            projectId: 'project-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            dueAt: 1000000000,
        }

        const first = await executeScheduledHeartbeat(payload)
        const second = await executeScheduledHeartbeat(payload)

        expect(first.outcome).toBe('executed')
        expect(second.outcome).toBe('already_processed')
        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
        expect(mockGeneratePreConfigTaskResult.mock.calls[0][12]).toEqual(
            expect.objectContaining({ maxRunWallClockMs: 25 * 60 * 1000 })
        )
        expect(admin.__mock.getDoc('assistants/project-1/items/assistant-1')).toEqual(
            expect.objectContaining({
                'heartbeatLastCheckedByUser.user-1': 1000000000,
                'heartbeatLastExecutedByUser.user-1': 1000000000,
            })
        )
        expect(admin.__mock.getDoc(`assistantHeartbeatSchedules/${scheduleId}`).lastProcessedDueAt).toBe(1000000000)
    })

    test('runs the next scheduled occurrence when the previous run finished inside the interval', async () => {
        const { scheduleId, scheduleHash } = seedSchedule()
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatLastExecutedByUser: { 'user-1': 999940000 },
        })

        const result = await executeScheduledHeartbeat({
            scheduleId,
            scheduleHash,
            projectId: 'project-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            dueAt: 1000000000,
        })

        expect(result.outcome).toBe('executed')
        expect(mockGeneratePreConfigTaskResult).toHaveBeenCalledTimes(1)
    })

    test('skips a stale schedule hash before running side effects', async () => {
        const { scheduleId } = seedSchedule()
        const result = await executeScheduledHeartbeat({
            scheduleId,
            scheduleHash: 'stale-hash',
            projectId: 'project-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            dueAt: 1000000000,
        })

        expect(result.outcome).toBe('stale_schedule')
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
    })

    test('records a chance skip without invoking the assistant', async () => {
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            ...admin.__mock.getDoc('assistants/project-1/items/assistant-1'),
            heartbeatChancePercent: 25,
            heartbeatChanceNoReplyPercent: 25,
        })
        Math.random.mockReturnValue(0.9)
        const { scheduleId, scheduleHash } = seedSchedule()

        const result = await executeScheduledHeartbeat({
            scheduleId,
            scheduleHash,
            projectId: 'project-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            dueAt: 1000000000,
        })

        expect(result.outcome).toBe('chance_skipped')
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
        expect(admin.__mock.getDoc(`assistantHeartbeatSchedules/${scheduleId}`).lastOutcome).toBe('chance_skipped')
    })

    test('records no-gold and sends the throttled notice without invoking the assistant', async () => {
        admin.__mock.setDoc('users/user-1', {
            ...admin.__mock.getDoc('users/user-1'),
            gold: 0,
        })
        const { scheduleId, scheduleHash } = seedSchedule()

        const result = await executeScheduledHeartbeat({
            scheduleId,
            scheduleHash,
            projectId: 'project-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            dueAt: 1000000000,
        })

        expect(result.outcome).toBe('no_gold')
        expect(mockGeneratePreConfigTaskResult).not.toHaveBeenCalled()
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
        expect(admin.__mock.getDoc(`assistantHeartbeatSchedules/${scheduleId}`).lastOutcome).toBe('no_gold')
    })

    test('records silent OK and guardrail outcomes through the worker', async () => {
        mockGeneratePreConfigTaskResult.mockResolvedValueOnce({ success: true, silentOk: true })
        const silentSchedule = seedSchedule()
        const silentResult = await executeScheduledHeartbeat({
            ...silentSchedule,
            projectId: 'project-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            dueAt: 1000000000,
        })
        expect(silentResult.outcome).toBe('silent_ok')
        expect(admin.__mock.getDoc('assistants/project-1/items/assistant-1')).toEqual(
            expect.objectContaining({ 'heartbeatLastSilentOkByUser.user-1': 1000000000 })
        )

        admin.__mock.reset()
        admin.__mock.setDoc('users/user-1', {
            uid: 'user-1',
            displayName: 'Test User',
            lastLogin: 1000000000,
            gold: 100,
        })
        admin.__mock.setDoc('projects/project-1', { active: true, userIds: ['user-1'] })
        admin.__mock.setDoc('assistants/project-1/items/assistant-1', {
            uid: 'assistant-1',
            heartbeatPrompt: 'Check in.',
            heartbeatChancePercent: 100,
            heartbeatChanceNoReplyPercent: 100,
            heartbeatAwakeStart: 0,
            heartbeatAwakeEnd: 86340000,
            heartbeatIntervalMs: 300000,
            heartbeatSendWhatsApp: false,
        })
        mockGeneratePreConfigTaskResult.mockResolvedValueOnce({
            success: true,
            guardrailStopped: { reason: 'time_budget', message: 'Stopped by time budget.' },
        })
        const guardrailSchedule = seedSchedule()
        const guardrailResult = await executeScheduledHeartbeat({
            ...guardrailSchedule,
            projectId: 'project-1',
            assistantId: 'assistant-1',
            userId: 'user-1',
            dueAt: 1000000000,
        })

        expect(guardrailResult.outcome).toBe('guardrail_failed')
        expect(admin.__mock.getDoc('assistants/project-1/items/assistant-1')).toEqual(
            expect.objectContaining({
                'heartbeatLastFailureByUser.user-1': 1000000000,
                'heartbeatLastFailureMessageByUser.user-1': 'Stopped by time budget.',
            })
        )
    })
})
