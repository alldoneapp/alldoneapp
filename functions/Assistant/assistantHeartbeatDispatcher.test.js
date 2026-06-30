jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
}))
jest.mock(
    'firebase-admin/functions',
    () => ({
        getFunctions: jest.fn(() => ({ taskQueue: jest.fn() })),
    }),
    { virtual: true }
)

const {
    dispatchDueHeartbeats,
    enqueueHeartbeatSchedule,
    isTaskAlreadyExistsError,
} = require('./assistantHeartbeatDispatcher')
const { getHeartbeatDispatchTaskId } = require('./assistantHeartbeatSchedule')

function buildTransactionDb(currentData) {
    const updates = []
    const db = {
        runTransaction: jest.fn(async callback =>
            callback({
                get: jest.fn(async () => ({ exists: true, data: () => currentData })),
                update: jest.fn((ref, data) => updates.push(data)),
            })
        ),
    }
    return { db, updates }
}

function buildScheduleDoc(data) {
    return {
        id: 'schedule-1',
        ref: { id: 'schedule-1' },
        data: () => data,
    }
}

describe('assistant heartbeat dispatcher', () => {
    const now = Date.parse('2026-06-30T10:00:00.000Z')
    const dueAt = now + 60 * 1000
    const schedule = {
        projectId: 'project-1',
        assistantId: 'assistant-1',
        userId: 'user-1',
        nextHeartbeatAt: dueAt,
        scheduleHash: 'timing-hash',
        intervalMs: 30 * 60 * 1000,
        awakeStartMs: 0,
        awakeEndMs: 86340000,
        timezoneName: 'UTC',
        timezoneOffsetMinutes: 0,
    }

    test('enqueues with deterministic identity and advances after durable enqueue', async () => {
        const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
        const { db, updates } = buildTransactionDb(schedule)

        const result = await enqueueHeartbeatSchedule(buildScheduleDoc(schedule), { db, queue, now })

        expect(queue.enqueue).toHaveBeenCalledWith(
            expect.objectContaining({ dueAt, scheduleHash: schedule.scheduleHash }),
            expect.objectContaining({
                id: getHeartbeatDispatchTaskId('schedule-1', schedule.scheduleHash, dueAt),
                scheduleTime: new Date(dueAt),
                dispatchDeadlineSeconds: 1800,
            })
        )
        expect(result).toEqual({ status: 'enqueued', advanced: true })
        expect(updates[0].nextHeartbeatAt).toBeGreaterThan(dueAt)
        expect(updates[0].lastEnqueuedDueAt).toBe(dueAt)
    })

    test('treats task-already-exists as durable and advances once', async () => {
        const queue = {
            enqueue: jest
                .fn()
                .mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'functions/task-already-exists' })),
        }
        const { db, updates } = buildTransactionDb(schedule)

        const result = await enqueueHeartbeatSchedule(buildScheduleDoc(schedule), { db, queue, now })

        expect(result).toEqual({ status: 'duplicate', advanced: true })
        expect(updates).toHaveLength(1)
    })

    test('leaves the occurrence due when enqueue fails', async () => {
        const queue = { enqueue: jest.fn().mockRejectedValue(new Error('permission denied')) }
        const { db, updates } = buildTransactionDb(schedule)

        const result = await enqueueHeartbeatSchedule(buildScheduleDoc(schedule), { db, queue, now })

        expect(result).toEqual({ status: 'failed' })
        expect(db.runTransaction).not.toHaveBeenCalled()
        expect(updates).toHaveLength(0)
    })

    test('recognizes supported task deduplication error codes', () => {
        expect(isTaskAlreadyExistsError({ code: 'functions/task-already-exists' })).toBe(true)
        expect(isTaskAlreadyExistsError({ code: 'already-exists' })).toBe(true)
        expect(isTaskAlreadyExistsError({ code: 6 })).toBe(true)
        expect(isTaskAlreadyExistsError({ code: 'permission-denied' })).toBe(false)
    })

    test('queries the lookahead window and dispatches the returned page', async () => {
        const first = buildScheduleDoc(schedule)
        const secondSchedule = { ...schedule, userId: 'user-2', nextHeartbeatAt: dueAt + 1000 }
        const second = {
            ...buildScheduleDoc(secondSchedule),
            id: 'schedule-2',
            ref: { id: 'schedule-2' },
        }
        first.ref.data = schedule
        second.ref.data = secondSchedule
        const query = {
            where: jest.fn(() => query),
            orderBy: jest.fn(() => query),
            limit: jest.fn(() => query),
            startAfter: jest.fn(() => query),
            get: jest.fn(async () => ({ docs: [first, second], empty: false })),
        }
        const db = {
            collection: jest.fn(() => query),
            runTransaction: jest.fn(async callback =>
                callback({
                    get: jest.fn(async ref => ({ exists: true, data: () => ref.data })),
                    update: jest.fn(),
                })
            ),
        }
        const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }

        const result = await dispatchDueHeartbeats({ db, queue, now })

        expect(query.where).toHaveBeenCalledWith('nextHeartbeatAt', '<=', now + 5 * 60 * 1000)
        expect(query.orderBy).toHaveBeenCalledWith('nextHeartbeatAt', 'asc')
        expect(query.limit).toHaveBeenCalledWith(200)
        expect(queue.enqueue).toHaveBeenCalledTimes(2)
        expect(result).toEqual(expect.objectContaining({ queried: 2, enqueued: 2, advanced: 2 }))
    })
})
