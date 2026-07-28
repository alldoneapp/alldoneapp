import { getSuggestedGoalPopoverLayout, SUGGESTED_GOAL_POPOVER_MAX_WIDTH } from './suggestedGoalPopoverHelper'

describe('getSuggestedGoalPopoverLayout', () => {
    test('keeps the suggestion card compact on desktop', () => {
        expect(getSuggestedGoalPopoverLayout(1007)).toEqual({
            width: SUGGESTED_GOAL_POPOVER_MAX_WIDTH,
            stackActions: false,
        })
    })

    test('fits inside a mobile viewport and stacks the actions', () => {
        expect(getSuggestedGoalPopoverLayout(375)).toEqual({
            width: 343,
            stackActions: true,
        })
    })

    test('uses a safe compact fallback when the viewport width is unavailable', () => {
        expect(getSuggestedGoalPopoverLayout(undefined)).toEqual({
            width: SUGGESTED_GOAL_POPOVER_MAX_WIDTH,
            stackActions: false,
        })
    })
})
