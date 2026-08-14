import {
    TASK_GOAL_ROUTING_AUTOMATIC,
    hasPendingGoalSuggestion,
    normalizeTaskGoalRoutingMode,
} from './TaskGoalSuggestion'

describe('TaskGoalSuggestion', () => {
    test('defaults missing or invalid project values to automatic routing', () => {
        expect(normalizeTaskGoalRoutingMode(TASK_GOAL_ROUTING_AUTOMATIC)).toBe(TASK_GOAL_ROUTING_AUTOMATIC)
        expect(normalizeTaskGoalRoutingMode('invalid')).toBe(TASK_GOAL_ROUTING_AUTOMATIC)
        expect(normalizeTaskGoalRoutingMode(undefined)).toBe(TASK_GOAL_ROUTING_AUTOMATIC)
    })

    test('only exposes unresolved suggestions for tasks without a goal', () => {
        expect(
            hasPendingGoalSuggestion({
                parentGoalId: null,
                goalSuggestion: { status: 'pending', goalId: 'goal1' },
            })
        ).toBe(true)
        expect(
            hasPendingGoalSuggestion({
                parentGoalId: 'goal2',
                goalSuggestion: { status: 'pending', goalId: 'goal1' },
            })
        ).toBe(false)
        expect(hasPendingGoalSuggestion({ goalSuggestion: { status: 'dismissed', goalId: 'goal1' } })).toBe(false)
    })
})
