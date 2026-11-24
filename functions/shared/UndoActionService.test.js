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
        'projects/project-1': snapshot(true, { userIds: ['user-1', 'user-2'] }),
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

    it('undoes task completion with its prior open-state metadata', async () => {
        const completionAction = createUndoActionRecord({
            actionId: 'action-1',
            initiatorId: 'user-1',
            label: 'Completed “Launch”',
            operations: [
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-1',
                    kind: 'update',
                    before: {
                        done: false,
                        inDone: false,
                        currentReviewerId: 'user-1',
                        stepHistory: ['open'],
                        sortIndex: 10,
                    },
                    beforeMissingFields: ['completed', 'completedTime'],
                    after: {
                        done: true,
                        inDone: true,
                        currentReviewerId: 'done',
                        completed: 2000,
                        completedTime: { startTime: 1000, endTime: 2000 },
                        stepHistory: ['open'],
                        sortIndex: 20,
                    },
                },
            ],
        })
        const { db, writes } = buildDb({
            action: completionAction,
            user: { projectIds: ['project-1'] },
            task: {
                done: true,
                inDone: true,
                currentReviewerId: 'done',
                completed: 2000,
                completedTime: { startTime: 1000, endTime: 2000 },
                stepHistory: ['open'],
                sortIndex: 20,
                isPublicFor: [0],
            },
        })

        await reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })

        const taskWrite = writes.find(write => write.path === 'items/project-1/tasks/task-1')
        expect(taskWrite.data).toMatchObject({
            done: false,
            inDone: false,
            currentReviewerId: 'user-1',
            stepHistory: ['open'],
            sortIndex: 10,
        })
        expect(taskWrite.data.completed).toBeDefined()
        expect(taskWrite.data.completedTime).toBeDefined()
    })

    it('undoes a workflow move to the exact prior step', async () => {
        const workflowAction = createUndoActionRecord({
            actionId: 'action-1',
            initiatorId: 'user-1',
            label: 'Moved “Launch” to another workflow step',
            operations: [
                {
                    objectType: 'task',
                    projectId: 'project-1',
                    objectId: 'task-1',
                    kind: 'update',
                    before: {
                        userIds: ['owner-1', 'reviewer-1'],
                        stepHistory: ['open', 'step-1'],
                        currentReviewerId: 'reviewer-1',
                        completed: 1000,
                    },
                    after: {
                        userIds: ['owner-1', 'reviewer-1', 'reviewer-2'],
                        stepHistory: ['open', 'step-1', 'step-2'],
                        currentReviewerId: 'reviewer-2',
                        completed: 2000,
                    },
                },
            ],
        })
        const { db, writes } = buildDb({
            action: workflowAction,
            user: { projectIds: ['project-1'] },
            task: {
                userIds: ['owner-1', 'reviewer-1', 'reviewer-2'],
                stepHistory: ['open', 'step-1', 'step-2'],
                currentReviewerId: 'reviewer-2',
                completed: 2000,
                isPublicFor: [0],
            },
        })

        await reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })

        expect(writes.find(write => write.path === 'items/project-1/tasks/task-1').data).toEqual({
            userIds: ['owner-1', 'reviewer-1'],
            stepHistory: ['open', 'step-1'],
            currentReviewerId: 'reviewer-1',
            completed: 1000,
        })
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

    // security audit 2026-11: undo records are owner-writable and replayed with the Admin SDK, so
    // every write a record leads to is re-authorized against the stored documents.
    describe('a forged undo record', () => {
        const forged = operations =>
            createUndoActionRecord({ actionId: 'action-1', initiatorId: 'user-1', label: 'Forged', operations })

        it('is refused in a project the user document lists but whose userIds omit the user', async () => {
            const { db, writes } = buildDb({
                action: forged([
                    {
                        objectType: 'task',
                        projectId: 'project-2',
                        objectId: 'task-9',
                        kind: 'update',
                        before: { name: 'Original' },
                        after: { name: 'Changed' },
                    },
                ]),
                user: { projectIds: ['project-1', 'project-2'] },
                objectSnapshots: {
                    'projects/project-2': snapshot(true, { userIds: ['victim'] }),
                    'items/project-2/tasks/task-9': snapshot(true, { name: 'Changed', isPublicFor: [0] }),
                },
            })

            await expect(
                reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })
            ).rejects.toMatchObject({ code: 'permission-denied' })
            expect(writes).toEqual([])
        })

        it('cannot blind-write fields through an empty expected state', async () => {
            const { db, writes } = buildDb({
                action: forged([
                    {
                        objectType: 'task',
                        projectId: 'project-1',
                        objectId: 'task-1',
                        kind: 'update',
                        before: { name: 'Overwritten', userId: 'user-1' },
                        after: {},
                    },
                ]),
                user: { projectIds: ['project-1'] },
                task: { name: 'Victim task', userId: 'user-2', isPublicFor: [0] },
            })

            await expect(
                reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })
            ).rejects.toMatchObject({ code: 'permission-denied' })
            expect(writes).toEqual([])
        })

        it('cannot delete an object through an empty expectedAfter', async () => {
            const { db, writes } = buildDb({
                action: forged([
                    {
                        objectType: 'task',
                        projectId: 'project-1',
                        objectId: 'task-1',
                        kind: 'create',
                        before: null,
                        after: {},
                        expectedAfter: {},
                    },
                ]),
                user: { projectIds: ['project-1'] },
                task: { name: 'Victim task', isPublicFor: [0] },
            })

            await expect(
                reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })
            ).rejects.toMatchObject({ code: 'permission-denied' })
            expect(writes).toEqual([])
        })

        it('cannot recreate a document the caller could not create through the rules', async () => {
            const recreate = after =>
                buildDb({
                    action: {
                        ...forged([
                            {
                                objectType: 'task',
                                projectId: 'project-1',
                                objectId: 'task-1',
                                kind: 'create',
                                before: null,
                                after,
                                expectedAfter: { name: 'x' },
                            },
                        ]),
                        status: 'undone',
                    },
                    user: { projectIds: ['project-1'] },
                    task: null,
                })

            for (const after of [
                { projectId: 'project-1', name: 'x', isPublicFor: ['user-2'] },
                { projectId: 'project-1', name: 'x', isPublicFor: [0], readerIds: ['user-1'] },
                { projectId: 'project-other', name: 'x', isPublicFor: [0] },
            ]) {
                const { db, writes } = recreate(after)
                await expect(
                    reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'redo' })
                ).rejects.toMatchObject({ code: 'permission-denied' })
                expect(writes).toEqual([])
            }

            const { db, writes } = recreate({ projectId: 'project-1', name: 'x', isPublicFor: [0, 'user-1'] })
            await expect(
                reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'redo' })
            ).resolves.toMatchObject({ status: 'applied' })
            expect(writes[0]).toMatchObject({ type: 'set', path: 'items/project-1/tasks/task-1' })
        })

        it('cannot hand an object away from the caller or rewrite its access projection', async () => {
            for (const before of [{ isPublicFor: ['user-2'] }, { readerIds: ['user-1'] }]) {
                const { db, writes } = buildDb({
                    action: forged([
                        {
                            objectType: 'task',
                            projectId: 'project-1',
                            objectId: 'task-1',
                            kind: 'update',
                            before,
                            after: { priority: 'must_do' },
                        },
                    ]),
                    user: { projectIds: ['project-1'] },
                    task: { priority: 'must_do', isPublicFor: [0] },
                })
                await expect(
                    reverseAction({ db, userId: 'user-1', actionId: 'action-1', direction: 'undo' })
                ).rejects.toMatchObject({ code: 'permission-denied' })
                expect(writes).toEqual([])
            }
        })
    })
})
