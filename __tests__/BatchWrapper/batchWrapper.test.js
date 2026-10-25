const { BatchWrapper } = require('../../functions/BatchWrapper/batchWrapper')

const createDb = () => {
    const committedWrites = []
    return {
        committedWrites,
        doc: path => ({ path }),
        batch: () => {
            const writes = []
            return {
                update: (ref, data) => writes.push({ operation: 'update', path: ref.path, data }),
                set: (ref, data, options) => writes.push({ operation: 'set', path: ref.path, data, options }),
                delete: ref => writes.push({ operation: 'delete', path: ref.path }),
                commit: async () => committedWrites.push(...writes),
            }
        },
    }
}

describe('BatchWrapper feed-object persistence', () => {
    test('does not duplicate legacy feed-state writes or invent an unknown project', async () => {
        const db = createDb()
        const batch = new BatchWrapper(db)
        const feedObject = { type: 'task', name: 'Task', taskId: 'task-1' }

        batch.set(db.doc('feedsObjectsLastStates/project-1/tasks/task-1'), feedObject, { merge: true })
        batch.feedObjects = { 'task-1': feedObject }

        await batch.commit()

        expect(db.committedWrites).toEqual([
            {
                operation: 'set',
                path: 'feedsObjectsLastStates/project-1/tasks/task-1',
                data: feedObject,
                options: { merge: true },
            },
        ])
        expect(db.committedWrites.some(write => write.path.includes('/unknown/'))).toBe(false)
    })

    test('persists TaskService structured feed objects to their explicit project path', async () => {
        const db = createDb()
        const batch = new BatchWrapper(db)
        const feedObject = { type: 'task', name: 'Task', taskId: 'task-1' }

        batch.feedObjects = {
            'task-1': {
                feedObject,
                projectId: 'project-1',
                objectType: 'tasks',
            },
        }

        await batch.commit()

        expect(db.committedWrites).toEqual([
            {
                operation: 'set',
                path: 'feedsObjectsLastStates/project-1/tasks/task-1',
                data: feedObject,
                options: { merge: true },
            },
        ])
    })
})
