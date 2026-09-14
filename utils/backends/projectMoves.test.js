const mockRunHttpsCallableFunction = jest.fn()
const mockGet = jest.fn()
const mockDoc = jest.fn(path => ({ get: () => mockGet(path) }))

jest.mock('./firestore', () => ({
    getDb: () => ({ doc: mockDoc }),
    runHttpsCallableFunction: (...args) => mockRunHttpsCallableFunction(...args),
}))

import { queueObjectProjectMove, waitForProjectMoveCompletion } from './projectMoves'

describe('client project move contract', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('uses one callable payload for every object type', async () => {
        mockRunHttpsCallableFunction.mockResolvedValue({ queued: true })

        await queueObjectProjectMove('project-a', 'project-b', 'skill', 'skill-1')

        expect(mockRunHttpsCallableFunction).toHaveBeenCalledWith('moveObjectToProjectSecondGen', {
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            objectType: 'skill',
            objectId: 'skill-1',
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
