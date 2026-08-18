/**
 * "Automatic" project selection for new tasks (AT-2306).
 *
 * A task always lives in exactly one project — the project is part of its
 * Firestore path (`items/{projectId}/tasks/{taskId}`), so there is no such thing
 * as a task without one. "Automatic" therefore does NOT defer creation: the task
 * is created immediately in a real host project (the user's default project) and
 * carries a `projectRouting` stamp that asks the server to re-home it.
 * `functions/Tasks/taskProjectRouting.js` picks the best-fitting project and
 * moves the task there through the existing `moveTaskToDifferentProject` helper.
 *
 * Creating first and routing after is what keeps the popup instant and offline-
 * safe: the task is durable the moment it is written, and the worst case of a
 * failed/declined classification is a task sitting in the default project, which
 * is exactly where it used to be created before this feature existed.
 *
 * This module is deliberately pure (no redux, no firebase) so both the picker UI
 * and its tests can use it, and so the field shape has one written-down home that
 * the Cloud Function contract can be checked against.
 */

export const AUTOMATIC_PROJECT_ROUTING_SOURCE = 'automatic_project_option'

export const PROJECT_ROUTING_STATUS_PENDING = 'pending'

/**
 * The project a task picked with "Automatic" is created in while it waits to be
 * routed. The user's default project when it is one of the projects offered,
 * otherwise the first offered project — never a project the user cannot write
 * to, which is why the candidate list (not the raw id) decides.
 *
 * @param {{ defaultProjectId?: string, projects?: Array<{ id: string }> }} params
 * @returns {string} a real project id, or '' when there is nothing to fall back to
 */
export const resolveAutomaticHostProjectId = ({ defaultProjectId, projects } = {}) => {
    const candidates = Array.isArray(projects) ? projects.filter(project => project && project.id) : []
    if (defaultProjectId && candidates.some(project => project.id === defaultProjectId)) return defaultProjectId
    if (defaultProjectId && candidates.length === 0) return defaultProjectId
    return candidates.length > 0 ? candidates[0].id : ''
}

/**
 * The `projectRouting` field stamped on a task created with "Automatic".
 * `hostProjectId` is recorded so the router can tell "the user never chose this
 * project" from "the user deliberately chose it", and so a routing decision that
 * keeps the task where it is stays explainable.
 */
export const buildPendingProjectRouting = ({ hostProjectId, now = Date.now() } = {}) => ({
    status: PROJECT_ROUTING_STATUS_PENDING,
    source: AUTOMATIC_PROJECT_ROUTING_SOURCE,
    hostProjectId: hostProjectId || '',
    requestedAt: now,
})
