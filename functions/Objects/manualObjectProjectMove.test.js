'use strict'

const mockSet = jest.fn()
const mockEnqueue = jest.fn()
const mockDoc = jest.fn(() => ({ set: mockSet }))

jest.mock('firebase-admin', () => ({
    app: () => ({ options: { projectId: 'test-project' } }),
    firestore: () => ({ doc: mockDoc }),
}))
jest.mock('firebase-admin/functions', () => ({
    getFunctions: () => ({ taskQueue: () => ({ enqueue: mockEnqueue }) }),
}))
jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: class HttpsError extends Error {
        constructor(code, message) {
            super(message)
            this.code = code
        }
    },
}))
jest.mock('../shared/privacyAccess', () => ({
    assertObjectAccess: jest.fn(),
    assertProjectAccess: jest.fn(),
    getObjectDocPath: (projectId, objectType, objectId) => `${objectType}/${projectId}/${objectId}`,
}))
jest.mock('../shared/moveObjectToDifferentProject', () => ({ moveObjectToDifferentProject: jest.fn() }))

const { enqueueManualObjectProjectMove } = require('./manualObjectProjectMove')

describe('manual object project move queue', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockSet.mockResolvedValue(undefined)
        mockEnqueue.mockResolvedValue(undefined)
    })

    test.each(['task', 'note', 'goal', 'contact', 'chat', 'skill'])('marks and queues a %s move', async objectType => {
        const result = await enqueueManualObjectProjectMove({
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            objectType,
            objectId: 'object-1',
            actorId: 'user-1',
        })

        expect(result).toEqual(expect.objectContaining({ queued: true, objectType, objectId: 'object-1' }))
        expect(mockSet).toHaveBeenCalledWith(
            expect.objectContaining({
                movingToOtherProjectId: 'project-b',
                projectMove: expect.objectContaining({ status: 'moving', targetProjectId: 'project-b' }),
            }),
            { merge: true }
        )
        expect(mockSet.mock.invocationCallOrder[0]).toBeLessThan(mockEnqueue.mock.invocationCallOrder[0])
    })

    it('clears the spinner marker when queue submission fails', async () => {
        mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))

        await expect(
            enqueueManualObjectProjectMove({
                sourceProjectId: 'project-a',
                targetProjectId: 'project-b',
                objectType: 'note',
                objectId: 'note-1',
                actorId: 'user-1',
            })
        ).rejects.toMatchObject({ code: 'unavailable' })
        expect(mockSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                movingToOtherProjectId: null,
                projectMove: expect.objectContaining({ status: 'failed' }),
            }),
            { merge: true }
        )
    })
})
