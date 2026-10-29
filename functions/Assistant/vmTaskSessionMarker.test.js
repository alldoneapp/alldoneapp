jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const {
    markTaskHasVmSession,
    syncVmSessionTaskDoneOnTaskUpdate,
    TASK_VM_SESSION_FIELD,
    SESSION_TASK_DONE_FIELD,
} = require('./vmTaskSessionMarker')

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

// AT-2916: the Anna VM overview lists paused VMs on open tasks only, from the session alone.
describe('mirroring the task state onto its VM session', () => {
    it('stamps the session at admission from the task it already reads, even for a marked task', async () => {
        const { db, update } = createDb({ [TASK_VM_SESSION_FIELD]: true, done: false })
        const sessionUpdate = jest.fn(() => Promise.resolve())
        await markTaskHasVmSession({
            projectId: 'p1',
            objectType: 'tasks',
            objectId: 't1',
            db,
            sessionRef: { update: sessionUpdate },
        })
        expect(sessionUpdate).toHaveBeenCalledWith({ [SESSION_TASK_DONE_FIELD]: false })
        expect(update).not.toHaveBeenCalled()
    })

    it.each([
        [false, true, true],
        [true, false, false],
    ])('writes when a VM task is done=%s -> %s', async (before, after, expected) => {
        const update = jest.fn(() => Promise.resolve())
        const doc = jest.fn(() => ({ update }))
        await expect(
            syncVmSessionTaskDoneOnTaskUpdate({
                projectId: 'p1',
                taskId: 't1',
                before: { [TASK_VM_SESSION_FIELD]: true, done: before },
                after: { [TASK_VM_SESSION_FIELD]: true, done: after },
                db: { doc },
            })
        ).resolves.toBe(true)
        expect(doc).toHaveBeenCalledWith('vmSessions/p1__t1')
        expect(update).toHaveBeenCalledWith({ [SESSION_TASK_DONE_FIELD]: expected })
    })

    it.each([
        [
            'an ordinary edit',
            { [TASK_VM_SESSION_FIELD]: true, done: false },
            { [TASK_VM_SESSION_FIELD]: true, done: false },
        ],
        ['a task without a VM session', { done: false }, { done: true }],
    ])('costs nothing for %s', async (_, before, after) => {
        const doc = jest.fn()
        await expect(
            syncVmSessionTaskDoneOnTaskUpdate({ projectId: 'p1', taskId: 't1', before, after, db: { doc } })
        ).resolves.toBe(false)
        expect(doc).not.toHaveBeenCalled()
    })

    it('never recreates a cleaned-up session and never throws', async () => {
        const missing = Object.assign(new Error('5 NOT_FOUND: No document to update'), { code: 5 })
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        await expect(
            syncVmSessionTaskDoneOnTaskUpdate({
                projectId: 'p1',
                taskId: 't1',
                before: { [TASK_VM_SESSION_FIELD]: true },
                after: { [TASK_VM_SESSION_FIELD]: true, done: true },
                db: { doc: () => ({ update: () => Promise.reject(missing) }) },
            })
        ).resolves.toBe(false)
        expect(warn).not.toHaveBeenCalled()
        warn.mockRestore()
    })
})
