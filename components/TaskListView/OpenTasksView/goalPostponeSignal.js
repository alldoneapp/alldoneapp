/**
 * AT-2541 — lets the Today goal section identify the one departure caused by postponing its final
 * task. The section still waits for the live lists to prove the goal really disappeared; a goal
 * that remains as an empty Today goal must not collapse.
 */

const listeners = new Set()

export const subscribeToGoalTaskPostpones = listener => {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export const publishGoalTaskPostpone = ({ projectId, goalId, taskId } = {}) => {
    if (!projectId || !goalId || !taskId) return
    const event = { projectId, goalId, taskId }
    Array.from(listeners).forEach(listener => {
        try {
            listener(event)
        } catch (error) {
            console.warn('[goal postpone] listener failed', error)
        }
    })
}

export const cancelGoalTaskPostpone = ({ projectId, goalId, taskId } = {}) => {
    if (!projectId || !goalId || !taskId) return
    const event = { projectId, goalId, taskId, cancelled: true }
    Array.from(listeners).forEach(listener => {
        try {
            listener(event)
        } catch (error) {
            console.warn('[goal postpone] cancellation listener failed', error)
        }
    })
}

/** Test seam. */
export const resetGoalTaskPostponeListeners = () => listeners.clear()
