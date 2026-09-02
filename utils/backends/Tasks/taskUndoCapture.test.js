import { captureTaskUndoStates } from './taskUndoCapture'
import { MAX_UNDO_OPERATIONS } from '../../undo/undoActions'

const PROJECT_ID = 'project-1'

const permissionDenied = () => {
    const error = new Error('Missing or insufficient permissions.')
    error.code = 'permission-denied'
    return error
}

const clientReader = docs =>
    jest.fn(async path => {
        const id = path.split('/').pop()
        if (docs[id] instanceof Error) throw docs[id]
        return docs[id] ? { exists: true, data: docs[id] } : { exists: false, data: undefined }
    })

describe('captureTaskUndoStates', () => {
    let log

    beforeEach(() => {
        log = jest.fn()
    })

    it('returns the current state of every requested task through the regular client', async () => {
        const readFromClient = clientReader({ task: { name: 'task' }, parent: { subtaskIds: ['task'] } })
        const readFromServer = jest.fn()

        const states = await captureTaskUndoStates({
            projectId: PROJECT_ID,
            taskIds: ['task', 'parent', 'task', null, undefined],
            readFromClient,
            readFromServer,
            log,
        })

        expect(states).toEqual({ task: { name: 'task' }, parent: { subtaskIds: ['task'] } })
        expect(readFromClient).toHaveBeenCalledTimes(2)
        expect(readFromServer).not.toHaveBeenCalled()
        expect(log).not.toHaveBeenCalled()
    })

    it('retries a failed client read once through the server and keeps the capture', async () => {
        const readFromClient = clientReader({ task: permissionDenied(), sub: { parentId: 'task' } })
        const readFromServer = jest.fn(async () => ({ exists: true, data: { name: 'from server' } }))

        const states = await captureTaskUndoStates({
            projectId: PROJECT_ID,
            taskIds: ['task', 'sub'],
            readFromClient,
            readFromServer,
            log,
        })

        expect(states).toEqual({ task: { name: 'from server' }, sub: { parentId: 'task' } })
        expect(readFromServer).toHaveBeenCalledTimes(1)
        expect(readFromServer).toHaveBeenCalledWith(`items/${PROJECT_ID}/tasks/task`)
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining('through the server'),
            expect.objectContaining({ taskId: 'task', clientError: 'permission-denied' })
        )
    })

    it('gives up on undo instead of failing when both reads fail', async () => {
        const readFromClient = clientReader({ task: permissionDenied() })
        const readFromServer = jest.fn(async () => {
            throw new Error('network down')
        })

        await expect(
            captureTaskUndoStates({ projectId: PROJECT_ID, taskIds: ['task'], readFromClient, readFromServer, log })
        ).resolves.toBeNull()

        expect(log).toHaveBeenCalledTimes(1)
        expect(log).toHaveBeenCalledWith(
            expect.stringContaining('continuing without undo'),
            expect.objectContaining({ taskId: 'task', error: 'network down', clientError: 'permission-denied' })
        )
    })

    it('gives up on undo when there is no server reader and the client read fails', async () => {
        const readFromClient = clientReader({ task: permissionDenied() })

        await expect(
            captureTaskUndoStates({ projectId: PROJECT_ID, taskIds: ['task'], readFromClient, log })
        ).resolves.toBeNull()
        expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'permission-denied' }))
    })

    it('leaves a task that no longer exists out of the states rather than failing the capture', async () => {
        const readFromClient = clientReader({ task: { name: 'task' } })

        const states = await captureTaskUndoStates({
            projectId: PROJECT_ID,
            taskIds: ['task', 'deleted-subtask'],
            readFromClient,
            readFromServer: jest.fn(),
            log,
        })

        expect(states).toEqual({ task: { name: 'task' } })
        expect(log).not.toHaveBeenCalled()
    })

    it('returns an empty capture for no ids and null above the undo operation limit', async () => {
        const readFromClient = jest.fn()

        await expect(
            captureTaskUndoStates({ projectId: PROJECT_ID, taskIds: [null], readFromClient, log })
        ).resolves.toEqual({})
        const tooMany = Array.from({ length: MAX_UNDO_OPERATIONS + 1 }, (_, index) => `task-${index}`)
        await expect(
            captureTaskUndoStates({ projectId: PROJECT_ID, taskIds: tooMany, readFromClient, log })
        ).resolves.toBeNull()
        expect(readFromClient).not.toHaveBeenCalled()
        expect(log).toHaveBeenCalledWith(expect.stringContaining('too many tasks'), expect.any(Object))
    })
})
