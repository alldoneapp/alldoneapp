/**
 * AT-2386 — deciding WHICH projects get their per-project data first.
 *
 * The app boots into "All projects" (`selectedProjectIndex` defaults to `ALL_PROJECTS_INDEX`),
 * so "load the current project first" has no obvious answer at login: there is no current
 * project. This module supplies one, as an ordered preference rather than a single id:
 *
 *   1. the project named in the URL we are about to route to,
 *   2. `inFocusTaskProjectId` — the user's explicitly pinned project, which the all-projects
 *      Tasks board already force-pins to the top (`openTasksViewProjectScope.js`),
 *   3. `defaultProjectId` — the project `getDefaultAssistant` reads to resolve
 *      `state.defaultAssistant`,
 *   4. the first project, so the list is never empty for an account that has projects.
 *
 * The first `PRIORITY_PROJECT_LIMIT` of those are AWAITED before URL routing runs; the rest are
 * warmed in the background. The await is not cosmetic — `TasksHelper.processURLProjectsUserTasks`
 * decides whether a `/projects/<id>/user/<uid>/tasks` deep link is reachable by looking the target
 * user up in `projectUsers[projectId]`, so routing before that project's users have arrived would
 * silently bounce a colleague's board back to "All projects". Same class of dependency:
 * `getDefaultAssistant` reads `projectAssistants[defaultProjectId]`.
 *
 * Everything here is pure (no redux, no firestore) so the ordering can be unit tested directly.
 */

/**
 * How many projects are loaded before login finishes. Kept small on purpose: each one costs four
 * collection reads, and the whole point of AT-2386 is that login stops waiting on the full set.
 */
export const PRIORITY_PROJECT_LIMIT = 3

const isNonEmptyString = value => typeof value === 'string' && value.length > 0

/**
 * Ordered, de-duplicated ids that should be loaded before the background sweep.
 *
 * `urlProjectId` is passed in rather than parsed here so the caller can use the app's own
 * `checkIfUrlBelongsToProjectInTheList`, which already knows every project-URL shape.
 */
export function resolvePriorityProjectIds({ urlProjectId, loggedUser, projectIds } = {}) {
    const ids = Array.isArray(projectIds) ? projectIds : []
    if (ids.length === 0) return []

    const known = new Set(ids)
    const ordered = []

    const push = candidate => {
        if (!isNonEmptyString(candidate)) return
        if (!known.has(candidate)) return
        if (ordered.includes(candidate)) return
        ordered.push(candidate)
    }

    push(urlProjectId)
    push(loggedUser && loggedUser.inFocusTaskProjectId)
    push(loggedUser && loggedUser.defaultProjectId)
    push(ids[0])

    return ordered.slice(0, PRIORITY_PROJECT_LIMIT)
}

/**
 * Every project, priority ones first, then the rest in their existing order.
 *
 * The remainder deliberately keeps `projectIds` order (which is the user document's order, the
 * same order the sidebar and the existing staggered watcher setup use) instead of inventing a
 * recency ranking: `project.lastActionDate` would be a better signal, but it lives on documents
 * that may not have arrived yet at the moment the sweep is scheduled.
 */
export function orderProjectsForDataWarmUp({ urlProjectId, loggedUser, projectIds } = {}) {
    const ids = Array.isArray(projectIds) ? projectIds.filter(isNonEmptyString) : []
    if (ids.length === 0) return { priorityProjectIds: [], warmUpProjectIds: [] }

    const priorityProjectIds = resolvePriorityProjectIds({ urlProjectId, loggedUser, projectIds: ids })
    const prioritySet = new Set(priorityProjectIds)

    const seen = new Set()
    const warmUpProjectIds = ids.filter(projectId => {
        if (prioritySet.has(projectId)) return false
        if (seen.has(projectId)) return false
        seen.add(projectId)
        return true
    })

    return { priorityProjectIds, warmUpProjectIds }
}
