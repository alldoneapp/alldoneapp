import { isTaskOnUserPlate, filterTasksOnUserPlate } from './focusTaskEligibility'

const OWNER = 'owner-uid'
const REVIEWER = 'reviewer-uid'
const ASSISTANT = 'assistant-uid'
const OPEN_STEP = -1

describe('isTaskOnUserPlate (client mirror)', () => {
    it('accepts an Open task for its owner', () => {
        expect(isTaskOnUserPlate({ userId: OWNER, currentReviewerId: OWNER, stepHistory: [OPEN_STEP] }, OWNER)).toBe(
            true
        )
    })

    // The production regression AT-2193 came back for: the release worked, but the replacement the
    // picker handed back was a task the user owns which had already moved to the assistant's step.
    it('rejects a task the owner has already handed on to another step', () => {
        expect(
            isTaskOnUserPlate(
                { userId: OWNER, userIds: [OWNER, ASSISTANT], currentReviewerId: ASSISTANT }, // parked
                OWNER
            )
        ).toBe(false)
    })

    it('accepts that same task for the reviewer who now holds it', () => {
        expect(isTaskOnUserPlate({ userId: OWNER, currentReviewerId: ASSISTANT }, ASSISTANT)).toBe(true)
    })

    it.each([[undefined], [null], ['']])('falls back to ownership when currentReviewerId is %p', reviewerId => {
        expect(isTaskOnUserPlate({ userId: OWNER, currentReviewerId: reviewerId }, OWNER)).toBe(true)
        expect(isTaskOnUserPlate({ userId: OWNER, currentReviewerId: reviewerId }, REVIEWER)).toBe(false)
    })

    it('handles missing arguments without throwing', () => {
        expect(isTaskOnUserPlate(null, OWNER)).toBe(false)
        expect(isTaskOnUserPlate({ currentReviewerId: OWNER }, null)).toBe(false)
        expect(isTaskOnUserPlate()).toBe(false)
    })

    // The client and server rules are duplicated because Cloud Functions cannot import from outside
    // functions/. They must agree, so the same table is asserted on both sides.
    it('matches the server rule on the shared table', () => {
        const cases = [
            [{ userId: OWNER, currentReviewerId: OWNER }, OWNER, true],
            [{ userId: OWNER, currentReviewerId: ASSISTANT }, OWNER, false],
            [{ userId: OWNER, currentReviewerId: ASSISTANT }, ASSISTANT, true],
            [{ userId: OWNER, currentReviewerId: -2, done: true }, OWNER, false],
            [{ userId: OWNER }, OWNER, true],
        ]

        cases.forEach(([task, userId, expected]) => {
            expect(isTaskOnUserPlate(task, userId)).toBe(expected)
        })
    })
})

describe('filterTasksOnUserPlate (client mirror)', () => {
    it('keeps only the tasks still on the user plate', () => {
        const mine = { id: 'a', userId: OWNER, currentReviewerId: OWNER }
        const parked = { id: 'b', userId: OWNER, currentReviewerId: ASSISTANT }

        expect(filterTasksOnUserPlate([mine, parked], OWNER)).toEqual([mine])
    })

    it('tolerates a non-array input', () => {
        expect(filterTasksOnUserPlate(undefined, OWNER)).toEqual([])
    })
})
