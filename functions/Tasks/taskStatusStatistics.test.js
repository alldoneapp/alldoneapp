const mockUpdateStatistics = jest.fn(() => Promise.resolve())

jest.mock('../Utils/statisticsHelper', () => ({
    updateStatistics: (...args) => mockUpdateStatistics(...args),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    OPEN_STEP: -1,
    isWorkstream: value => String(value || '').startsWith('ws_'),
}))

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const { buildCrossUserTaskStatusChange, persistCrossUserTaskStatusStatistics } = require('./taskStatusStatistics')

const completedAt = 1788134400000

const task = overrides => ({
    userId: 'owner-1',
    lastEditorId: 'reviewer-1',
    done: false,
    completed: null,
    estimations: { [-1]: 60 },
    taskStatisticsTransition: null,
    ...overrides,
})

const crossUserMarker = {
    taskStatisticsTransition: { id: 'transition-1', actorId: 'reviewer-1', ownerId: 'owner-1' },
}

const makeDb = ({ claimExists = false, projectMemberIds = ['owner-1', 'reviewer-1'] } = {}) => {
    const refs = new Map()
    const doc = jest.fn(path => {
        if (!refs.has(path)) {
            refs.set(path, {
                path,
                get: jest.fn(async () => ({
                    exists: path.startsWith('projects/'),
                    data: () => ({ userIds: projectMemberIds }),
                })),
            })
        }
        return refs.get(path)
    })
    const transaction = {
        get: jest.fn(async () => ({ exists: claimExists })),
        set: jest.fn(),
    }
    const db = {
        doc,
        runTransaction: jest.fn(callback => callback(transaction)),
    }
    return { db, transaction }
}

describe('cross-user task status statistics', () => {
    beforeEach(() => jest.clearAllMocks())

    test('builds a completion for the owner when a reviewer checks the task', () => {
        expect(
            buildCrossUserTaskStatusChange(task(), task({ done: true, completed: completedAt, ...crossUserMarker }))
        ).toEqual({
            ownerId: 'owner-1',
            actorId: 'reviewer-1',
            transitionId: 'transition-1',
            estimation: 60,
            subtract: false,
            completed: completedAt,
        })
    })

    test('leaves owner-driven and workstream transitions on the client path', () => {
        expect(
            buildCrossUserTaskStatusChange(
                task({ lastEditorId: 'owner-1' }),
                task({ lastEditorId: 'owner-1', done: true, completed: completedAt, ...crossUserMarker })
            )
        ).toBeNull()
        expect(
            buildCrossUserTaskStatusChange(
                task({ userId: 'ws_team' }),
                task({ userId: 'ws_team', done: true, completed: completedAt, ...crossUserMarker })
            )
        ).toBeNull()
    })

    test('writes a cross-user completion once and records an idempotency claim', async () => {
        const { db, transaction } = makeDb()

        await expect(
            persistCrossUserTaskStatusStatistics({
                db,
                eventId: 'event-1',
                projectId: 'project-1',
                taskId: 'task-1',
                oldTask: task(),
                newTask: task({ done: true, completed: completedAt, ...crossUserMarker }),
                now: completedAt + 1,
            })
        ).resolves.toBe(true)

        expect(mockUpdateStatistics).toHaveBeenCalledWith(
            'project-1',
            'owner-1',
            60,
            false,
            false,
            completedAt,
            expect.objectContaining({ db })
        )
        expect(transaction.set).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'taskStatisticsEvents/event-1' }),
            expect.objectContaining({
                eventId: 'event-1',
                ownerId: 'owner-1',
                actorId: 'reviewer-1',
                expiresAt: new Date(completedAt + 1 + 30 * 24 * 60 * 60 * 1000),
            })
        )
    })

    test('skips a duplicate event claim', async () => {
        const { db } = makeDb({ claimExists: true })

        await expect(
            persistCrossUserTaskStatusStatistics({
                db,
                eventId: 'event-1',
                projectId: 'project-1',
                taskId: 'task-1',
                oldTask: task(),
                newTask: task({ done: true, completed: completedAt, ...crossUserMarker }),
            })
        ).resolves.toBe(false)

        expect(mockUpdateStatistics).not.toHaveBeenCalled()
    })

    test('subtracts the original completion when a reviewer reopens a task', () => {
        expect(
            buildCrossUserTaskStatusChange(task({ done: true, completed: completedAt }), task({ ...crossUserMarker }))
        ).toEqual(expect.objectContaining({ subtract: true, completed: completedAt }))
    })

    test('uses the signed transition timestamp for a subtask without its own completed field', () => {
        expect(
            buildCrossUserTaskStatusChange(
                task({ parentId: 'parent-1' }),
                task({
                    parentId: 'parent-1',
                    done: true,
                    ...crossUserMarker,
                    taskStatisticsTransition: {
                        ...crossUserMarker.taskStatisticsTransition,
                        completed: completedAt,
                    },
                })
            )
        ).toEqual(expect.objectContaining({ subtract: false, completed: completedAt }))
    })
})
