/**
 * AT-2558 — a task row leaving Today can tell its own project block why it is about to leave.
 *
 * The open-task listener can remove the project before the independent sidebar counter reports the
 * clearing. This small, in-memory channel carries the fact the row already knows; the project-exit
 * hook still cross-checks it against the board's own `lineWouldLeave` verdict, so completing or
 * postponing a task in a project with work left never animates the project away.
 *
 * Listeners are indexed by project rather than broadcast to every mounted project block. All
 * Projects can mount dozens of them, while a completion concerns exactly one.
 */

/** @type {Map<string, Set<Function>>} */
const listenersByProject = new Map()

export const subscribeToProjectTaskExits = (projectId, listener) => {
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

const publishProjectTaskExit = ({ projectId, taskId } = {}) => {
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
            console.warn('[project task exit] listener failed', error)
        }
    })
}

export const publishProjectTaskCompletion = event => publishProjectTaskExit(event)

/**
 * A due-date change uses the same narrowly-scoped handoff as completion. This is intentionally
 * published by `postponeTaskWithMotion`, not by the Firestore helper: that coordinator knows the
 * visible Today row is top-level, its placement date is changing, and the action is a user-facing
 * postpone rather than a background or bulk update.
 */
export const publishProjectTaskPostpone = ({ projectId, taskId } = {}) => {
    publishProjectTaskExit({ projectId, taskId })
}

/** Backwards-compatible name for the completion callers and focused tests introduced first. */
export const subscribeToProjectTaskCompletions = subscribeToProjectTaskExits

/** Test seam. Never call from app code. */
export const resetProjectTaskExitListeners = () => {
    listenersByProject.clear()
}

export const resetProjectTaskCompletionListeners = resetProjectTaskExitListeners
