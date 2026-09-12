/**
 * AT-2550 — a completing task row can tell its own project block why it is about to leave.
 *
 * The normal completed-project sweep is inferred from `sidebarNumbers`. Suggested-task workflow
 * bypasses also update the task through the open-task listener, and that listener can remove the
 * project before the independent sidebar counter reports the clearing. This small, in-memory
 * channel carries the fact the row already knows; `useProjectCompletedSweep` still cross-checks it
 * against the board's own `lineWouldLeave` verdict, so completing a task in a project with work
 * left never animates the project away.
 *
 * Listeners are indexed by project rather than broadcast to every mounted project block. All
 * Projects can mount dozens of them, while a completion concerns exactly one.
 */

/** @type {Map<string, Set<Function>>} */
const listenersByProject = new Map()

export const subscribeToProjectTaskCompletions = (projectId, listener) => {
    if (!projectId || typeof listener !== 'function') return () => {}

    let listeners = listenersByProject.get(projectId)
    if (!listeners) {
        listeners = new Set()
        listenersByProject.set(projectId, listeners)
    }
    listeners.add(listener)

    return () => {
        const current = listenersByProject.get(projectId)
        if (!current) return
        current.delete(listener)
        if (current.size === 0) listenersByProject.delete(projectId)
    }
}

export const publishProjectTaskCompletion = ({ projectId, taskId } = {}) => {
    if (!projectId || !taskId) return
    const event = { projectId, taskId }
    const listeners = listenersByProject.get(projectId)
    if (!listeners) return

    Array.from(listeners).forEach(listener => {
        try {
            listener(event)
        } catch (error) {
            // This runs inside the task row's completion handoff. A broken animation listener must
            // never prevent the Firestore write that actually completes the task.
            console.warn('[project completion] listener failed', error)
        }
    })
}

/** Test seam. Never call from app code. */
export const resetProjectTaskCompletionListeners = () => {
    listenersByProject.clear()
}
