import store from '../../redux/store'
import { addProjectData } from '../../redux/actions'
import { getInitialProjectData } from './initialLoadHelper'

/**
 * Recovery for projects dropped from redux by a transient read failure.
 *
 * When the backend is unreachable during InitialLoad, project reads can be answered by the local
 * cache as "missing" and the project is dropped for the whole session — the `Update user project`
 * reducer can only merge into an EXISTING map entry, so the live watcher's later data had nowhere
 * to go and the project stayed missing until a manual reload.
 *
 * `recoverDroppedProject` is called by the project watcher when data arrives for a project that
 * is not in `loggedUserProjectsMap`. It re-fetches the full initial bundle (users, contacts,
 * workstreams, assistants) so the project enters redux in the same complete shape InitialLoad
 * would have produced, then inserts it via the data-only 'Add project data' action (no
 * navigation). Guards:
 * - only for the logged (non-anonymous) user's own `projectIds`,
 * - one recovery in flight per project (later watcher snapshots retry a failed/skipped one),
 * - a bundle with no users is treated as another degraded read and skipped — a real project
 *   always has at least its owner as a member.
 */

const recoveringProjectIds = new Set()

export const resetProjectRecoveryForTests = () => recoveringProjectIds.clear()

export async function recoverDroppedProject(projectId) {
    const { loggedUser, loggedUserProjectsMap } = store.getState()
    if (!loggedUser || !loggedUser.uid || loggedUser.isAnonymous) return false
    if (loggedUserProjectsMap[projectId]) return false
    if (!Array.isArray(loggedUser.projectIds) || !loggedUser.projectIds.includes(projectId)) return false
    if (recoveringProjectIds.has(projectId)) return false

    recoveringProjectIds.add(projectId)
    try {
        const { project, users, contacts, workstreams, assistants } = await getInitialProjectData(projectId)
        if (!project || !Array.isArray(users) || users.length === 0) return false

        // Re-check: InitialLoad or a competing recovery may have inserted it meanwhile.
        if (store.getState().loggedUserProjectsMap[projectId]) return false

        store.dispatch(
            addProjectData(
                { ...project, id: projectId },
                users,
                Array.isArray(workstreams) ? workstreams : [],
                Array.isArray(contacts) ? contacts : [],
                Array.isArray(assistants) ? assistants : []
            )
        )
        console.warn(`[InitialLoad] Recovered project ${projectId} that was dropped by a failed initial read`)
        return true
    } catch (error) {
        console.warn(`[InitialLoad] Failed to recover project ${projectId}:`, error)
        return false
    } finally {
        recoveringProjectIds.delete(projectId)
    }
}
