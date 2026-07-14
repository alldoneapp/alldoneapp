const { createUndoActionRecord, reverseAction } = require('./UndoActionService')

const snapshot = (exists, data) => ({ exists, data: () => data })

const buildDb = ({ action, user, task }) => {
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
})
