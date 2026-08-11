/**
 * Cross-component registry of assistant/VM runs the user has already asked to stop.
 *
 * The Stop control is rendered in more than one place for the very same run: the full
 * chat view's MessageItemContent and the comment popup's CommentsList can be mounted at
 * the same time, and the popup is unmounted and remounted every time it is dismissed.
 * A local `useState` flag therefore cannot answer "did we already send this?" — the
 * second surface would happily fire a duplicate `cancelAssistantRunSecondGen` call, and
 * a reopened popup would offer an enabled Stop button for a run that is already
 * stopping.
 *
 * Keying on the runId (not the comment id) is what makes that work: it is the identity
 * the backend cancels, and it is stable across surfaces. Entries are intentionally kept
 * until the run's Firestore status leaves `running` (which removes the button anyway) or
 * the request fails, so this never needs to be pruned on a timer.
 */

const requestedRunIds = new Set()
const listeners = new Set()

const notify = () => {
    listeners.forEach(listener => listener())
}

export const isStopRequestedForRun = runId => !!runId && requestedRunIds.has(runId)

export const markStopRequestedForRun = runId => {
    if (!runId || requestedRunIds.has(runId)) return false
    requestedRunIds.add(runId)
    notify()
    return true
}

export const clearStopRequestForRun = runId => {
    if (!runId || !requestedRunIds.delete(runId)) return
    notify()
}

export const subscribeToStopRequests = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

// Test helper: the registry is module state, so suites must be able to start clean.
export const resetStopRequests = () => {
    requestedRunIds.clear()
    listeners.clear()
}
