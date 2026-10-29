jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const { markTaskHasVmSession, TASK_VM_SESSION_FIELD } = require('./vmTaskSessionMarker')

const createDb = task => {
    const update = jest.fn(() => Promise.resolve())
    const doc = jest.fn(() => ({
        get: () => Promise.resolve({ exists: task !== null, data: () => task }),
        update,
    }))
    return { db: { doc }, doc, update }
}

describe('markTaskHasVmSession', () => {
    it('marks a task whose thread hosts its first VM job', async () => {
        const { db, doc, update } = createDb({ name: 'Fix the login' })
        await expect(markTaskHasVmSession({ projectId: 'p1', objectType: 'tasks', objectId: 't1', db })).resolves.toBe(
            true
        )
        expect(doc).toHaveBeenCalledWith('items/p1/tasks/t1')
        // No edition data: the marker is not an edit and must not re-sync the task everywhere.
        expect(update).toHaveBeenCalledWith({ [TASK_VM_SESSION_FIELD]: true })
    })

    it('does not write again for a task that is already marked', async () => {
        const { db, update } = createDb({ [TASK_VM_SESSION_FIELD]: true })
        await expect(markTaskHasVmSession({ projectId: 'p1', objectType: 'tasks', objectId: 't1', db })).resolves.toBe(
            false
        )
        expect(update).not.toHaveBeenCalled()
    })

    it('never recreates a deleted task as a stub', async () => {
        const { db, update } = createDb(null)
        await expect(markTaskHasVmSession({ projectId: 'p1', objectType: 'tasks', objectId: 't1', db })).resolves.toBe(
            false
        )
        expect(update).not.toHaveBeenCalled()
    })

    it('ignores threads that are not tasks', async () => {
        const { db, doc } = createDb({})
        await expect(markTaskHasVmSession({ projectId: 'p1', objectType: 'topics', objectId: 'c1', db })).resolves.toBe(
            false
        )
        expect(doc).not.toHaveBeenCalled()
    })

    it('never throws into the VM job', async () => {
        const db = {
            doc: () => ({
                get: () => Promise.reject(new Error('unavailable')),
            }),
        }
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        await expect(markTaskHasVmSession({ projectId: 'p1', objectType: 'tasks', objectId: 't1', db })).resolves.toBe(
            false
        )
        warn.mockRestore()
    })
})
