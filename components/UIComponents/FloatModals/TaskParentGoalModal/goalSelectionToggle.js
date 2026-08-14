/**
 * Decides whether a goal click means "select" or "unselect" without allowing a live background
 * update to change that meaning while the picker is open.
 *
 * The goal router can assign a goal shortly after a task is created. If that assignment lands
 * between opening this picker and clicking the same goal, comparing only with the live selection
 * makes the click do the opposite of what the user intended. The task editor's stale-write guards
 * then correctly preserve the unseen assignment, so the incorrect unselect becomes a successful
 * but visible no-op.
 *
 * Toggle decisions therefore use both the live selection and the selection at the last user choice
 * in this picker. Background state may update what is displayed, but only the user advances the
 * interaction baseline.
 */

export const goalSelectionId = goal => (goal && goal.id ? goal.id : null)

export const shouldUnselectGoal = (clickedGoal, selectedGoal, selectionAtLastUserChoice) => {
    const clickedId = goalSelectionId(clickedGoal)
    if (!clickedId) return false

    return goalSelectionId(selectedGoal) === clickedId && selectionAtLastUserChoice === clickedId
}

export default shouldUnselectGoal
