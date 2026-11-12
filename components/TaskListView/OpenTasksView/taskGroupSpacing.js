/**
 * The gap between two task groups of one day on the open-tasks board: a goal card, an empty goal
 * or a "General tasks" group. The main list and the Calendar section both use it, so a goal reads
 * the same in either place. The last group of a list has no gap below it.
 */
export const TASK_GROUP_SPACING = 32

export const getTaskGroupSpacingStyle = isLast => ({ marginBottom: isLast ? 0 : TASK_GROUP_SPACING })
