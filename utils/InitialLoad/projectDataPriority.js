/**
 * AT-2386 — the exact per-project data dependencies that must settle before initial URL routing.
 *
 * Most project collections can stay lazy. There are only two boot-time consumers:
 *
 *   1. a project URL may synchronously resolve a user/contact/workstream/assistant from that
 *      project's redux slices, so the route project needs its complete data bundle;
 *   2. `getDefaultAssistant` reads the default project's assistant slice. That collection starts
 *      before routing; All Projects gives it only a short cache budget, while a project deep link
 *      still waits for every route-critical dependency.
 *
 * The in-focus project and the first sidebar project are useful rendering priorities, but neither
 * is a routing dependency. Awaiting all four collections for them made an ordinary cold start fan
 * out to as many as twelve listeners before routing could finish.
 *
 * This module stays pure (no redux or Firestore imports) so membership scoping is easy to pin in
 * tests. `urlProjectId` is already parsed by the app's canonical URL helper before it reaches here.
 */

const isKnownProjectId = (projectId, knownProjectIds) =>
    typeof projectId === 'string' && projectId.length > 0 && knownProjectIds.has(projectId)

export function resolveBootCriticalProjectIds({ urlProjectId, loggedUser, projectIds } = {}) {
    const knownProjectIds = new Set(Array.isArray(projectIds) ? projectIds : [])
    const defaultProjectId = loggedUser && loggedUser.defaultProjectId

    return {
        routeProjectId: isKnownProjectId(urlProjectId, knownProjectIds) ? urlProjectId : null,
        defaultAssistantProjectId: isKnownProjectId(defaultProjectId, knownProjectIds) ? defaultProjectId : null,
    }
}
