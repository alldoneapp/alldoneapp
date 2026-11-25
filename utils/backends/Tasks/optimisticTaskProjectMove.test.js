const mockGet = jest.fn()

jest.mock('../firestore', () => ({
    getDb: () => ({ doc: path => ({ get: options => mockGet(path, options) }) }),
}))

import { didServerAcceptTaskMove, isAmbiguousCallableFailure } from './optimisticTaskProjectMove'
import {
    buildOptimisticMovedTaskDoc,
    beginLocalTaskProjectMove,
    endLocalTaskProjectMove,
    isIncomingTaskProjectMovePending,
    isTaskMovingOutOfProject,
    resetLocalTaskProjectMoves,
    subscribeLocalTaskProjectMoves,
} from './localTaskProjectMoves'

describe('task project move: optimistic destination document', () => {
    const base = {
        name: 'Task',
        userId: 'owner',
        userIds: ['owner', 'reviewer'],
        currentReviewerId: 'reviewer',
        stepHistory: [-1, 'step-1'],
        isPublicFor: ['owner'],
        parentGoalId: 'goal-in-source',
        parentGoalIsPublicFor: [0],
        observersIds: ['observer'],
        done: false,
        inDone: false,
    }
    const build = (task, userIds) =>
        buildOptimisticMovedTaskDoc(task, {
            sourceProjectId: 'a',
            targetProject: { id: 'b', userIds },
            actorId: 'actor',
            timestamp: 1000,
        })

    it('keeps an owner who is a member of the destination and resets the workflow like the worker', () => {
        const moved = build(base, ['owner', 'actor'])

        expect(moved).toEqual(
            expect.objectContaining({
                userId: 'owner',
                userIds: ['owner'],
                currentReviewerId: 'owner',
                stepHistory: [-1],
                observersIds: [],
                parentGoalId: null,
                parentGoalIsPublicFor: null,
                sortIndex: 1000,
                movingToOtherProjectId: null,
                projectMove: expect.objectContaining({ status: 'moving', sourceProjectId: 'a', targetProjectId: 'b' }),
            })
        )
    })

    it('hands the task to the mover when its owner is not in the destination, and keeps them able to see it', () => {
        const moved = build(base, ['actor'])

        expect(moved.userId).toBe('actor')
        expect(moved.currentReviewerId).toBe('actor')
        expect(moved.isPublicFor).toEqual(['owner', 'actor'])
    })

    it('turns a moved subtask into a top-level task', () => {
        const moved = build({ ...base, parentId: 'parent', isSubtask: true, parentDone: true }, ['owner'])

        expect(moved).toEqual(
            expect.objectContaining({ parentId: null, isSubtask: false, parentDone: false, inDone: false })
        )
    })
})

describe('task project move: local state', () => {
    afterEach(() => resetLocalTaskProjectMoves())

    it('hides the task and its subtasks in the source project only, until the move ends', () => {
        const events = []
        subscribeLocalTaskProjectMoves(event => events.push(event.type))

        const move = beginLocalTaskProjectMove({
            sourceProjectId: 'a',
            targetProjectId: 'b',
            taskId: 't',
            subtaskIds: ['s'],
        })
        expect(isTaskMovingOutOfProject('a', 't')).toBe(true)
        expect(isTaskMovingOutOfProject('a', 's')).toBe(true)
        expect(isTaskMovingOutOfProject('b', 't')).toBe(false)

        endLocalTaskProjectMove(move)
        endLocalTaskProjectMove(move)
        expect(isTaskMovingOutOfProject('a', 't')).toBe(false)
        expect(events).toEqual(['begin', 'end'])
    })

    it('never hides the destination copy, which carries the same running move', () => {
        const destinationCopy = {
            projectMove: { status: 'moving', sourceProjectId: 'a', targetProjectId: 'b', requestedAt: Date.now() },
        }

        expect(isTaskMovingOutOfProject('b', 't', destinationCopy)).toBe(false)
        expect(isTaskMovingOutOfProject('a', 't', destinationCopy)).toBe(true)
        expect(isIncomingTaskProjectMovePending(destinationCopy, 'b')).toBe(true)
        expect(isIncomingTaskProjectMovePending(destinationCopy, 'a')).toBe(false)
    })
})

describe('task project move: ambiguous callable failures', () => {
    beforeEach(() => mockGet.mockReset())

    it('treats the SDK deadline and transport errors as ambiguous, but not a refusal', () => {
        expect(isAmbiguousCallableFailure({ code: 'deadline-exceeded' })).toBe(true)
        expect(isAmbiguousCallableFailure({ code: 'functions/internal' })).toBe(true)
        expect(isAmbiguousCallableFailure({ code: 'permission-denied' })).toBe(false)
        expect(isAmbiguousCallableFailure({ code: 'offline' })).toBe(false)
    })

    it('reads the source document from the server to decide whether the move was accepted', async () => {
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ projectMove: { status: 'moving', targetProjectId: 'b' } }),
        })
        await expect(didServerAcceptTaskMove('a', 'b', 't')).resolves.toBe(true)
        expect(mockGet).toHaveBeenCalledWith('items/a/tasks/t', { source: 'server' })

        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ projectMove: { status: 'failed', targetProjectId: 'b' } }),
        })
        await expect(didServerAcceptTaskMove('a', 'b', 't')).resolves.toBe(false)

        mockGet.mockResolvedValueOnce({ exists: false, data: () => undefined })
        await expect(didServerAcceptTaskMove('a', 'b', 't')).resolves.toBe(true)

        mockGet.mockRejectedValueOnce(new Error('offline'))
        await expect(didServerAcceptTaskMove('a', 'b', 't')).resolves.toBeNull()
    })
})
