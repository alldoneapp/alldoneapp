const { createUndoActionRecord, reverseAction } = require('./UndoActionService')

const snapshot = (exists, data) => ({ exists, data: () => data })

const buildDb = ({ action, user, task, objectSnapshots = {} }) => {
    const refs = new Map()
    const writes = []
    const ref = path => {
        if (!refs.has(path)) refs.set(path, { path })
        return refs.get(path)
    }
    const snapshots = {
        'users/user-1/undoActions/action-1': snapshot(true, action),
        'users/user-1': snapshot(true, user),
        'items/project-1/tasks/task-1': snapshot(!!task, task),
        ...objectSnapshots,
    }
    const transaction = {
        get: jest.fn(reference => Promise.resolve(snapshots[reference.path] || snapshot(false))),
        update: jest.fn((reference, data) => writes.push({ type: 'update', path: reference.path, data })),
        set: jest.fn((reference, data) => writes.push({ type: 'set', path: reference.path, data })),
        delete: jest.fn(reference => writes.push({ type: 'delete', path: reference.path })),
    }
    return {
        db: {
            doc: jest.fn(ref),
            runTransaction: jest.fn(handler => handler(transaction)),
        },
        writes,
    }
}

const action = createUndoActionRecord({
    actionId: 'action-1',
    initiatorId: 'user-1',
    label: 'Changed task priority',
    operations: [
        {
            objectType: 'task',
            projectId: 'project-1',
            objectId: 'task-1',
            kind: 'update',
            before: { priority: 'none' },
            after: { priority: 'must_do' },
        },
    ],
})

describe('UndoActionService', () => {
    it('reverses touched task fields and marks the action undone', async () => {
        const { db, writes } = buildDb({
            action,
            user: { projectIds: ['project-1'] },
            task: { priority: 'must_do', name: 'Unrelated newer name', isPublicFor: [0] },
        })

        const result = await reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })

        expect(result.status).toBe('undone')
        expect(writes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: 'items/project-1/tasks/task-1',
                    data: { priority: 'none' },
                }),
            ])
        )
    })

    it('refuses to overwrite a field changed after the original action', async () => {
        const { db } = buildDb({
            action,
            user: { projectIds: ['project-1'] },
            task: { priority: 'should_do', isPublicFor: [0] },
        })

        await expect(
            reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })
        ).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    it('restores a postponed goal and all still-connected tasks without touching unrelated fields', async () => {
        const postponeAction = createUndoActionRecord({
            actionId: 'action-1',
            initiatorId: 'user-1',
            label: 'Postponed goal “Launch”',
            operations: [
                {
                    objectType: 'goal',
                    projectId: 'project-1',
                    objectId: 'goal-1',
                    kind: 'update',
                    before: { 'assigneesReminderDate.user-1': 1000, timesPostponed: 2 },
                    after: { 'assigneesReminderDate.user-1': 5000, timesPostponed: 3 },
                },
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-1',
                    kind: 'update',
                    before: { dueDate: 1100, sortIndex: 10, timesPostponed: 4 },
                    after: { dueDate: 5000, sortIndex: 20, timesPostponed: 5 },
                    skipIfMissing: true,
                    requiredCurrentFields: { parentGoalId: 'goal-1' },
                },
            ],
        })
        const { db, writes } = buildDb({
            action: postponeAction,
            user: { projectIds: ['project-1'] },
            task: {
                dueDate: 5000,
                sortIndex: 20,
                timesPostponed: 5,
                parentGoalId: 'goal-1',
                name: 'Unrelated task name',
                isPublicFor: [0],
            },
            objectSnapshots: {
                'goals/project-1/items/goal-1': snapshot(true, {
                    assigneesReminderDate: { 'user-1': 5000, 'user-2': 1500 },
                    timesPostponed: 3,
                    description: 'Unrelated goal description',
                    isPublicFor: [0],
                }),
            },
        })

        const result = await reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })

        expect(result).toMatchObject({ status: 'undone', skippedOperationCount: 0 })
        expect(writes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: 'goals/project-1/items/goal-1',
                    data: { 'assigneesReminderDate.user-1': 1000, timesPostponed: 2 },
                }),
                expect.objectContaining({
                    path: 'items/project-1/tasks/task-1',
                    data: { dueDate: 1100, sortIndex: 10, timesPostponed: 4 },
                }),
            ])
        )
        expect(writes.some(write => write.data?.name || write.data?.description)).toBe(false)
    })

    it('skips deleted and disconnected tasks while still restoring the goal', async () => {
        const postponeAction = createUndoActionRecord({
            actionId: 'action-1',
            initiatorId: 'user-1',
            label: 'Postponed goal “Launch”',
            operations: [
                {
                    objectType: 'goal',
                    projectId: 'project-1',
                    objectId: 'goal-1',
                    kind: 'update',
                    before: { 'assigneesReminderDate.user-1': 1000 },
                    after: { 'assigneesReminderDate.user-1': 5000 },
                },
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-deleted',
                    kind: 'update',
                    before: { dueDate: 1000 },
                    after: { dueDate: 5000 },
                    skipIfMissing: true,
                    requiredCurrentFields: { parentGoalId: 'goal-1' },
                },
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-disconnected',
                    kind: 'update',
                    before: { dueDate: 1200 },
                    after: { dueDate: 5000 },
                    skipIfMissing: true,
                    requiredCurrentFields: { parentGoalId: 'goal-1' },
                },
            ],
        })
        const { db, writes } = buildDb({
            action: postponeAction,
            user: { projectIds: ['project-1'] },
            objectSnapshots: {
                'goals/project-1/items/goal-1': snapshot(true, {
                    assigneesReminderDate: { 'user-1': 5000 },
                    isPublicFor: [0],
                }),
                'items/project-1/tasks/task-disconnected': snapshot(true, {
                    dueDate: 5000,
                    parentGoalId: null,
                    isPublicFor: [0],
                }),
            },
        })

        const result = await reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })

        expect(result).toMatchObject({ status: 'undone', skippedOperationCount: 2 })
        expect(writes.some(write => write.path.includes('task-deleted'))).toBe(false)
        expect(writes.some(write => write.path.includes('task-disconnected'))).toBe(false)
        expect(writes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: 'goals/project-1/items/goal-1',
                    data: { 'assigneesReminderDate.user-1': 1000 },
                }),
                expect.objectContaining({
                    path: 'users/user-1/undoActions/action-1',
                    data: expect.objectContaining({ skippedOperationIndexes: [1, 2] }),
                }),
            ])
        )
    })

    it('removes a counter that did not exist before postponement', async () => {
        const postponeAction = createUndoActionRecord({
            actionId: 'action-1',
            initiatorId: 'user-1',
            label: 'Postponed goal “Launch”',
            operations: [
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-1',
                    kind: 'update',
                    before: { dueDate: 1000 },
                    beforeMissingFields: ['timesPostponed'],
                    after: { dueDate: 5000, timesPostponed: 1 },
                },
            ],
        })
        const { db, writes } = buildDb({
            action: postponeAction,
            user: { projectIds: ['project-1'] },
            task: { dueDate: 5000, timesPostponed: 1, isPublicFor: [0] },
        })

        await reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })

        const taskWrite = writes.find(write => write.path === 'items/project-1/tasks/task-1')
        expect(taskWrite.data.dueDate).toBe(1000)
        expect(taskWrite.data.timesPostponed).toBeDefined()
    })
})
