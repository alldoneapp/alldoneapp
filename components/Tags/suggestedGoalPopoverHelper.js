export const SUGGESTED_GOAL_POPOVER_MAX_WIDTH = 400
export const SUGGESTED_GOAL_POPOVER_GUTTER = 32
export const SUGGESTED_GOAL_STACK_ACTIONS_BREAKPOINT = 420

export const getSuggestedGoalPopoverLayout = windowWidth => {
    const safeWindowWidth =
        typeof windowWidth === 'number' && Number.isFinite(windowWidth) && windowWidth > 0
            ? windowWidth
            : SUGGESTED_GOAL_POPOVER_MAX_WIDTH + SUGGESTED_GOAL_POPOVER_GUTTER

    return {
        width: Math.min(SUGGESTED_GOAL_POPOVER_MAX_WIDTH, Math.max(0, safeWindowWidth - SUGGESTED_GOAL_POPOVER_GUTTER)),
        stackActions: safeWindowWidth < SUGGESTED_GOAL_STACK_ACTIONS_BREAKPOINT,
    }
}
