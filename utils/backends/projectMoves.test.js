const mockRunHttpsCallableFunction = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn(path => ({ get: () => mockGet(path) }))

jest.mock('./firestore', () => ({
    getDb: () => ({ doc: mockDoc }),
    runHttpsCallableFunction: (...args) => mockRunHttpsCallableFunction(...args),
}))

import { PROJECT_MOVE_CALLABLE_TIMEOUT_MS, queueObjectProjectMove, waitForProjectMoveCompletion } from './projectMoves'

describe('client project move contract', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('uses one callable payload for every object type', async () => {
        mockRunHttpsCallableFunction.mockResolvedValue({ queued: true })

        await queueObjectProjectMove('project-a', 'project-b', 'skill', 'skill-1')

        expect(mockRunHttpsCallableFunction).toHaveBeenCalledWith(
            'moveObjectToProjectSecondGen',
            {
                sourceProjectId: 'project-a',
                targetProjectId: 'project-b',
                objectType: 'skill',
                objectId: 'skill-1',
            },
            // Longer than a cold start, so the SDK does not report a move the server then completes.
            { timeout: PROJECT_MOVE_CALLABLE_TIMEOUT_MS }
        )
        expect(PROJECT_MOVE_CALLABLE_TIMEOUT_MS).toBeGreaterThan(120000)
    })

    it('stops waiting when the caller cancels', async () => {
        mockGet.mockImplementation(async () => ({ exists: false, data: () => undefined }))

        await expect(
            waitForProjectMoveCompletion('project-a', 'project-b', 'task', 'task-1', 100, { isCancelled: () => true })
        ).rejects.toMatchObject({ code: 'cancelled' })
    })

    it('marks a failed move so callers can tell it from a timeout', async () => {
        mockGet.mockImplementation(async path => ({
            exists: true,
            data: () => (path.includes('project-a') ? { projectMove: { status: 'failed' } } : {}),
        }))

        await expect(
            waitForProjectMoveCompletion('project-a', 'project-b', 'task', 'task-1', 100)
        ).rejects.toMatchObject({
            code: 'move-failed',
        })
    })

    it('resolves only after the destination reports completion', async () => {
        mockGet.mockImplementation(async path => ({
            exists: path.includes('project-b'),
            data: () =>
                path.includes('project-b') ? { title: 'Moved note', projectMove: { status: 'completed' } } : undefined,
        }))

        await expect(waitForProjectMoveCompletion('project-a', 'project-b', 'note', 'note-1', 100)).resolves.toEqual(
            expect.objectContaining({ id: 'note-1', title: 'Moved note' })
        )
    })

    it('rejects an explicit terminal failure on the source', async () => {
        mockGet.mockImplementation(async path => ({
            exists: path.includes('project-a'),
            data: () => (path.includes('project-a') ? { projectMove: { status: 'failed' } } : undefined),
        }))

        await expect(waitForProjectMoveCompletion('project-a', 'project-b', 'goal', 'goal-1', 100)).rejects.toThrow(
            'The goal move failed'
        )
    })
})
