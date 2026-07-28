export const TASK_GOAL_ROUTING_OFF = 'off'
export const TASK_GOAL_ROUTING_SUGGESTIONS = 'suggestions'
export const TASK_GOAL_ROUTING_AUTOMATIC = 'automatic'

const VALID_TASK_GOAL_ROUTING_MODES = new Set([
    TASK_GOAL_ROUTING_OFF,
    TASK_GOAL_ROUTING_SUGGESTIONS,
    TASK_GOAL_ROUTING_AUTOMATIC,
])

export const normalizeTaskGoalRoutingMode = mode =>
    VALID_TASK_GOAL_ROUTING_MODES.has(mode) ? mode : TASK_GOAL_ROUTING_AUTOMATIC

export const hasPendingGoalSuggestion = task =>
    !task?.parentGoalId && task?.goalSuggestion?.status === 'pending' && !!task.goalSuggestion.goalId
