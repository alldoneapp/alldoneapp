const { isTaskOnUserPlate, filterTasksOnUserPlate } = require('./focusTaskEligibility')

const OWNER = 'owner-uid'
const REVIEWER = 'reviewer-uid'
const ASSISTANT = 'assistant-uid'
const OPEN_STEP = -1
const DONE_STEP = -2

describe('isTaskOnUserPlate', () => {
    it('accepts an Open task for its owner', () => {
        // In the Open step the owner IS the current reviewer (TaskModelBuilder writes
        // `currentReviewerId: currentReviewerId || userId`), so no special case is needed.
        expect(isTaskOnUserPlate({ userId: OWNER, currentReviewerId: OWNER, stepHistory: [OPEN_STEP] }, OWNER)).toBe(
            true
        )
    })

    // The exact production regression: the owner still owns the task, but it has moved on to the
    // assistant's workflow step, so it is not theirs to work on and must not be their focus task.
    it('rejects a task the owner has already handed on to another step', () => {
        const task = {
            userId: OWNER,
            userIds: [OWNER, ASSISTANT],
            currentReviewerId: ASSISTANT,
            stepHistory: [OPEN_STEP, 'step-1'],
        }
        expect(isTaskOnUserPlate(task, OWNER)).toBe(false)
    })

    it('accepts that same task for the reviewer who now holds it', () => {
        const task = {
            userId: OWNER,
            userIds: [OWNER, ASSISTANT],
            currentReviewerId: ASSISTANT,
            stepHistory: [OPEN_STEP, 'step-1'],
        }
        expect(isTaskOnUserPlate(task, ASSISTANT)).toBe(true)
    })

    it('rejects a completed task for everyone', () => {
        const task = { userId: OWNER, currentReviewerId: DONE_STEP, done: true }
        expect(isTaskOnUserPlate(task, OWNER)).toBe(false)
        expect(isTaskOnUserPlate(task, REVIEWER)).toBe(false)
    })

    // AT-2188: a VM agent asking a question parks currentReviewerId on the user who has to answer
    // WITHOUT moving the step. That user really does have to act, so the task stays focusable for
    // them — which is why the rule reads currentReviewerId rather than stepHistory.
    it('follows a VM interaction hold to the user being asked', () => {
        const task = {
            userId: OWNER,
            userIds: [OWNER, REVIEWER],
            currentReviewerId: OWNER,
            stepHistory: [OPEN_STEP, 'step-1'],
        }
        expect(isTaskOnUserPlate(task, OWNER)).toBe(true)
        expect(isTaskOnUserPlate(task, REVIEWER)).toBe(false)
    })

    // Documents predating currentReviewerId must not all become unfocusable, or the picker starves.
    it.each([[undefined], [null], ['']])('falls back to ownership when currentReviewerId is %p', reviewerId => {
        expect(isTaskOnUserPlate({ userId: OWNER, currentReviewerId: reviewerId }, OWNER)).toBe(true)
        expect(isTaskOnUserPlate({ userId: OWNER, currentReviewerId: reviewerId }, REVIEWER)).toBe(false)
    })

    it('handles missing arguments without throwing', () => {
        expect(isTaskOnUserPlate(null, OWNER)).toBe(false)
        expect(isTaskOnUserPlate({ currentReviewerId: OWNER }, null)).toBe(false)
        expect(isTaskOnUserPlate()).toBe(false)
    })
})

describe('filterTasksOnUserPlate', () => {
    it('keeps only the tasks still on the user plate', () => {
        const mine = { id: 'a', userId: OWNER, currentReviewerId: OWNER }
        const parked = { id: 'b', userId: OWNER, currentReviewerId: ASSISTANT }

        expect(filterTasksOnUserPlate([mine, parked], OWNER)).toEqual([mine])
    })

    it('tolerates a non-array input', () => {
        expect(filterTasksOnUserPlate(undefined, OWNER)).toEqual([])
    })
})
