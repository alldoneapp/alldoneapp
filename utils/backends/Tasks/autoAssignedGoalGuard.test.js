import {
    clearsUnseenAutoAssignedGoal,
    isRouterAssignedGoal,
    payloadSawAssignment,
    preserveAutoAssignedGoal,
} from './autoAssignedGoalGuard'

const GOAL_ID = '-NLXzBzy4yXzneUTR41I'
const OTHER_GOAL_ID = '-OQDJWlLZ8yXwrgbXajd'

const autoAssignedSuggestion = (overrides = {}) => ({
    status: 'auto_assigned',
    goalId: GOAL_ID,
    claimId: 'hjuF2yIfPYbJBwkht5Td',
    projectId: '-M6X9vdIokG7HAammHGg',
    source: 'task_goal_router',
    confidence: 0.94,
    createdAt: 1786480503739,
    ...overrides,
})

/** The task exactly as the goal router leaves it: goal fields and suggestion written together. */
const liveAssignedTask = (overrides = {}) => ({
    id: '-OzmXH_QWFHTrwjdTZ_v',
    name: 'a task karsten typed',
    parentGoalId: GOAL_ID,
    parentGoalIsPublicFor: [0],
    lockKey: 'lock-1',
    goalSuggestion: autoAssignedSuggestion(),
    ...overrides,
})

/** The copy an editor took before the router wrote anything. */
const staleEditorPayload = (overrides = {}) => ({
    id: '-OzmXH_QWFHTrwjdTZ_v',
    name: 'a task karsten typed some more',
    parentGoalId: null,
    parentGoalIsPublicFor: null,
    lockKey: '',
    goalSuggestion: null,
    ...overrides,
})

describe('isRouterAssignedGoal', () => {
    it('recognises a goal the router assigned on its own', () => {
        expect(isRouterAssignedGoal(liveAssignedTask())).toBe(true)
    })

    it('ignores a task with no goal', () => {
        expect(isRouterAssignedGoal(liveAssignedTask({ parentGoalId: null }))).toBe(false)
    })

    it('ignores a goal the user chose, even with a suggestion on the task', () => {
        expect(isRouterAssignedGoal(liveAssignedTask({ parentGoalId: OTHER_GOAL_ID }))).toBe(false)
    })

    it.each(['pending', 'dismissed', 'accepted', 'superseded', 'classifying', 'failed'])(
        'ignores a %s suggestion',
        status => {
            expect(isRouterAssignedGoal(liveAssignedTask({ goalSuggestion: autoAssignedSuggestion({ status }) }))).toBe(
                false
            )
        }
    )

    it('survives a task without a suggestion at all', () => {
        expect(isRouterAssignedGoal({ parentGoalId: GOAL_ID })).toBe(false)
        expect(isRouterAssignedGoal(undefined)).toBe(false)
    })
})

describe('payloadSawAssignment', () => {
    it('is true when the payload carries the same routing run', () => {
        expect(payloadSawAssignment(liveAssignedTask(), liveAssignedTask())).toBe(true)
    })

    it('is false for a payload built before the router wrote anything', () => {
        expect(payloadSawAssignment(staleEditorPayload(), liveAssignedTask())).toBe(false)
    })

    it('is false for a payload stuck on the claim phase of the same run', () => {
        const classifying = { status: 'classifying', claimId: 'hjuF2yIfPYbJBwkht5Td' }
        expect(payloadSawAssignment(staleEditorPayload({ goalSuggestion: classifying }), liveAssignedTask())).toBe(
            false
        )
    })

    it('falls back to a deep comparison for legacy suggestions without a claimId', () => {
        const legacy = { status: 'auto_assigned', goalId: GOAL_ID }
        const live = liveAssignedTask({ goalSuggestion: legacy })
        expect(payloadSawAssignment({ goalSuggestion: { ...legacy } }, live)).toBe(true)
        expect(payloadSawAssignment({ goalSuggestion: { status: 'pending', goalId: GOAL_ID } }, live)).toBe(false)
    })
})

describe('preserveAutoAssignedGoal', () => {
    it('AT-2277 - keeps the goal when a stale editor save would drop it', () => {
        const live = liveAssignedTask()

        const preserved = preserveAutoAssignedGoal(staleEditorPayload(), live)

        expect(preserved.parentGoalId).toBe(GOAL_ID)
        expect(preserved.parentGoalIsPublicFor).toEqual([0])
        expect(preserved.lockKey).toBe('lock-1')
        expect(preserved.goalSuggestion).toEqual(live.goalSuggestion)
    })

    it('keeps everything else the editing session actually changed', () => {
        const preserved = preserveAutoAssignedGoal(
            staleEditorPayload({ name: 'renamed while the router was thinking', priority: 3 }),
            liveAssignedTask()
        )

        expect(preserved.name).toBe('renamed while the router was thinking')
        expect(preserved.priority).toBe(3)
    })

    it('does not mutate the payload it was given', () => {
        const payload = staleEditorPayload()

        preserveAutoAssignedGoal(payload, liveAssignedTask())

        expect(payload.parentGoalId).toBeNull()
    })

    it('lets the user remove a goal they can actually see', () => {
        const live = liveAssignedTask()
        const deliberate = { ...live, parentGoalId: null, parentGoalIsPublicFor: null, lockKey: '' }

        expect(clearsUnseenAutoAssignedGoal(deliberate, live)).toBe(false)
        expect(preserveAutoAssignedGoal(deliberate, live)).toBe(deliberate)
    })

    it('lets the user move the task to a different goal', () => {
        const live = liveAssignedTask()
        const moved = { ...staleEditorPayload(), parentGoalId: OTHER_GOAL_ID, parentGoalIsPublicFor: [0] }

        expect(preserveAutoAssignedGoal(moved, live).parentGoalId).toBe(OTHER_GOAL_ID)
    })

    it('never resurrects a goal that is already gone from the live task', () => {
        const live = liveAssignedTask({ parentGoalId: null, parentGoalIsPublicFor: null, lockKey: '' })

        expect(preserveAutoAssignedGoal(staleEditorPayload(), live).parentGoalId).toBeNull()
    })

    it('stays out of the way once the suggestion has been resolved', () => {
        const live = liveAssignedTask({ goalSuggestion: autoAssignedSuggestion({ status: 'dismissed' }) })

        expect(preserveAutoAssignedGoal(staleEditorPayload(), live)).toEqual(staleEditorPayload())
    })

    it('returns the payload untouched when there is nothing to guard', () => {
        const payload = staleEditorPayload()

        expect(preserveAutoAssignedGoal(payload, { parentGoalId: null })).toBe(payload)
        expect(preserveAutoAssignedGoal(payload, undefined)).toBe(payload)
        expect(preserveAutoAssignedGoal(undefined, liveAssignedTask())).toBeUndefined()
    })
})
