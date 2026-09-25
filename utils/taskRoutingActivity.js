/**
 * AT-2381 — what a task row should say about the server still deciding where it belongs.
 *
 * Two independent Cloud Functions classify a freshly created task, both from the same
 * `onCreateTask` fan-out (`functions/Tasks/onCreateTaskFunctions.js`):
 *
 *   - `taskProjectRouting.js` picks the best-fitting PROJECT when the task was created with
 *     the add-task popup's "Automatic" option, and physically re-homes it.
 *   - `taskGoalRouting.js` picks a GOAL inside the task's project and either attaches it or
 *     offers it as a suggestion.
 *
 * Both leave their whole state machine on the task document, so this module is pure: it
 * reads a mapped task and answers whether classification is still running or a goal was
 * just attached. Automatic project moves already get a reason comment on the task, so
 * they need no separate confirmation badge or row animation.
 */

// How long after the server settled a decision the confirmation is still worth playing.
// Generous rather than tight: `resolvedAt` is the FUNCTION's clock, the comparison runs on
// the BROWSER's, and the two are only loosely related (see `utils/serverClock.js` for how
// much they can drift). A wide window absorbs that skew, and replay is prevented by the
// once-per-signature latch in `useTaskRoutingActivity` rather than by a tight deadline.
export const ROUTING_CONFIRMATION_WINDOW_MS = 60000

// Both classifiers run inside the same 540-second Cloud Function. Ten minutes therefore outlives
// every legitimate invocation while giving old `classifying` records a deterministic end in the UI.
// The write guard prevents new stale records; this bound also makes already-stranded documents quiet.
export const ROUTING_PROCESSING_WINDOW_MS = 10 * 60 * 1000

export const ROUTING_ACTIVITY_PROCESSING = 'processing'
export const ROUTING_ACTIVITY_CONFIRMED = 'confirmed'

export const ROUTING_SUBJECT_PROJECT = 'project'
export const ROUTING_SUBJECT_GOAL = 'goal'

// `projectRouting.status === 'pending'` is stamped CLIENT-side at creation time
// (`utils/automaticProjectRouting.js`) and means "the server has not picked this up yet";
// `'classifying'` is the server's own claim. Both are the user waiting, so both sparkle.
// Note this collides with `goalSuggestion.status === 'pending'`, which means the opposite —
// a settled suggestion waiting for the USER. Never treat the two vocabularies as one.
const PROJECT_ROUTING_IN_FLIGHT = new Set(['pending', 'classifying'])

// The goal router has no client-stamped pending state; it claims the task itself.
const GOAL_ROUTING_IN_FLIGHT = new Set(['classifying'])

const getProjectRoutingStartedAt = projectRouting =>
    projectRouting?.status === 'pending'
        ? projectRouting.requestedAt
        : projectRouting?.startedAt || projectRouting?.requestedAt

const getProcessingCandidate = (task, now) => {
    if (!task) return null

    if (PROJECT_ROUTING_IN_FLIGHT.has(task.projectRouting?.status)) {
        const startedAt = getProjectRoutingStartedAt(task.projectRouting)
        if (Number.isFinite(startedAt) && now - startedAt <= ROUTING_PROCESSING_WINDOW_MS) {
            return { subject: ROUTING_SUBJECT_PROJECT, expiresAt: startedAt + ROUTING_PROCESSING_WINDOW_MS }
        }
    }

    if (GOAL_ROUTING_IN_FLIGHT.has(task.goalSuggestion?.status)) {
        const startedAt = task.goalSuggestion.createdAt
        if (Number.isFinite(startedAt) && now - startedAt <= ROUTING_PROCESSING_WINDOW_MS) {
            return { subject: ROUTING_SUBJECT_GOAL, expiresAt: startedAt + ROUTING_PROCESSING_WINDOW_MS }
        }
    }

    return null
}

const isFresh = (resolvedAt, now) => {
    if (!Number.isFinite(resolvedAt) || resolvedAt <= 0) return false
    // Only the lower bound is enforced. A `resolvedAt` in the future means the function's
    // clock ran ahead of the browser's, which is skew rather than staleness — rejecting it
    // would drop exactly the confirmations that just happened.
    return now - resolvedAt <= ROUTING_CONFIRMATION_WINDOW_MS
}

/**
 * True while a server check is still deciding something about this task.
 *
 * @param {object} task a task as mapped by `mapTaskData`
 * @returns {null | { subject: 'project' | 'goal' }}
 */
export const getTaskRoutingProcessing = (task, now = Date.now()) => {
    const candidate = getProcessingCandidate(task, now)
    return candidate ? { subject: candidate.subject } : null
}

/** When the current processing indicator must stop even if Firestore never sends another snapshot. */
export const getTaskRoutingProcessingExpiresAt = (task, now = Date.now()) =>
    getProcessingCandidate(task, now)?.expiresAt || null

/**
 * True just after the goal router attached a goal. Project moves are deliberately omitted:
 * the automatic router writes a reason comment, and user-initiated moves use a separate flow.
 *
 * @param {object} task a task as mapped by `mapTaskData`
 * @param {string} projectId the project the row is currently being rendered in
 * @param {number} now
 * @returns {null | { subject: 'goal', goalId: string, signature: string }}
 */
export const getTaskRoutingConfirmation = (task, projectId, now = Date.now()) => {
    if (!task) return null

    const goalSuggestion = task.goalSuggestion
    if (goalSuggestion?.status === 'auto_assigned' && isFresh(goalSuggestion.resolvedAt, now)) {
        // The auto-assign write sets `parentGoalId` and `goalSuggestion` in ONE transaction
        // (taskGoalRouting.js:574-580), so a task whose live `parentGoalId` no longer matches
        // the suggestion has had the goal changed or removed since — by the user, by Undo, or
        // by a later move nulling it. Requiring agreement is the same test
        // `utils/backends/Tasks/autoAssignedGoalGuard.js` uses to recognise a live auto-assign.
        if (goalSuggestion.goalId && task.parentGoalId === goalSuggestion.goalId) {
            return {
                subject: ROUTING_SUBJECT_GOAL,
                goalId: goalSuggestion.goalId,
                signature: `goal:${task.id}:${goalSuggestion.resolvedAt}`,
            }
        }
    }

    return null
}

/**
 * The row's whole routing state in one call. Confirmation wins over processing: a task that
 * has just been assigned a goal can still carry a processing state, but the settled result
 * is more useful to show first.
 *
 * @returns {null | { kind: 'processing'|'confirmed', subject: 'project'|'goal', ... }}
 */
export const getTaskRoutingActivity = (task, projectId, now = Date.now()) => {
    const confirmation = getTaskRoutingConfirmation(task, projectId, now)
    if (confirmation) return { kind: ROUTING_ACTIVITY_CONFIRMED, ...confirmation }

    const processing = getTaskRoutingProcessing(task, now)
    if (processing) return { kind: ROUTING_ACTIVITY_PROCESSING, ...processing }

    return null
}
