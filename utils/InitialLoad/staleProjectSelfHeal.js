import firebase from 'firebase/compat/app'

import store from '../../redux/store'
import { getDb } from '../backends/firestore'

/**
 * Self-heal for stale project ids on the logged user's document.
 *
 * A user document can keep ids of projects whose docs no longer exist (deleted project whose
 * member-unlink batch never reached this user, revoked membership, interrupted deletion). Those
 * ids re-arm a boot-time race on every cold load: InitialLoad skips the project ("has no data"),
 * but because `isProjectMember` in firestore.rules is based on the USER doc's `projectIds`, the
 * per-project watchers still start, observe the missing doc, and dispatch `removeProjectData`
 * while task stores may still reference the project (the estimationType production crash).
 *
 * The heal removes such ids from the user document — but only under strict conditions, because
 * this is a destructive write driven by an absence signal:
 * - only ids currently in `loggedUser.projectIds` (the list that drives InitialLoad),
 * - never for anonymous users,
 * - never for ids in `copyProjectIds` (a project duplication in flight may not have its doc yet),
 * - each id is re-confirmed with a server-only read (`source: 'server'`) right before the write.
 *   A plain `get()`/listener can report "missing" from the local persistence cache; an offline or
 *   denied server read throws and the id is simply left alone for a future session.
 * - at most once per id per session, so repeated load/refresh cycles cannot loop writes.
 *
 * The user-doc watcher (`watchLoggedUserData`) syncs the shrunken id lists back into redux, so no
 * local state is touched here.
 */

/**
 * Ids of projects whose InitialLoad read SUCCEEDED but whose doc is gone. A failed read produces
 * a `null` entry (see `loadProjectsDataFromFirebase`) and must never become a prune candidate.
 */
export const getMissingProjectEntriesIds = loadResults =>
    (Array.isArray(loadResults) ? loadResults : [])
        .filter(entry => entry && entry.projectId && !entry.project)
        .map(entry => entry.projectId)

const handledProjectIdsInSession = new Set()

export const resetStaleProjectSelfHealForTests = () => handledProjectIdsInSession.clear()

const confirmProjectIsGoneOnServer = async projectId => {
    try {
        const snapshot = await getDb().doc(`projects/${projectId}`).get({ source: 'server' })
        return !snapshot.exists
    } catch (error) {
        // Offline or permission-denied: absence is not confirmed, keep the id.
        return false
    }
}

export async function pruneStaleProjectIds(candidateProjectIds) {
    const { loggedUser } = store.getState()
    if (!loggedUser || !loggedUser.uid || loggedUser.isAnonymous) return []

    const activeProjectIds = Array.isArray(loggedUser.projectIds) ? loggedUser.projectIds : []
    const copyProjectIdsInFlight = new Set(Array.isArray(loggedUser.copyProjectIds) ? loggedUser.copyProjectIds : [])

    const candidates = [...new Set(Array.isArray(candidateProjectIds) ? candidateProjectIds : [])].filter(
        projectId =>
            !!projectId &&
            !handledProjectIdsInSession.has(projectId) &&
            activeProjectIds.includes(projectId) &&
            !copyProjectIdsInFlight.has(projectId)
    )
    if (candidates.length === 0) return []

    // Mark before the async confirms so overlapping calls (initial load + background refresh +
    // project watchers) cannot double-process the same id; a failed confirm/write re-arms below.
    candidates.forEach(projectId => handledProjectIdsInSession.add(projectId))

    const confirmations = await Promise.all(candidates.map(confirmProjectIsGoneOnServer))
    const confirmedGoneIds = candidates.filter((projectId, index) => confirmations[index])
    candidates.forEach(projectId => {
        if (!confirmedGoneIds.includes(projectId)) handledProjectIdsInSession.delete(projectId)
    })
    if (confirmedGoneIds.length === 0) return []

    // Same id-list fields the regular project-deletion flow scrubs per member
    // (see `unlinkDeletedProjectFromMembers` in utils/backends/firestore.js).
    const arrayRemove = firebase.firestore.FieldValue.arrayRemove(...confirmedGoneIds)
    try {
        await getDb().doc(`users/${loggedUser.uid}`).update({
            projectIds: arrayRemove,
            archivedProjectIds: arrayRemove,
            templateProjectIds: arrayRemove,
            guideProjectIds: arrayRemove,
            copyProjectIds: arrayRemove,
            invitedProjectIds: arrayRemove,
        })
    } catch (error) {
        confirmedGoneIds.forEach(projectId => handledProjectIdsInSession.delete(projectId))
        console.warn('[InitialLoad] Failed to remove stale project ids from the user document:', error)
        return []
    }

    console.warn(
        `[InitialLoad] Removed ${confirmedGoneIds.length} stale project id(s) from the user document:`,
        confirmedGoneIds
    )
    return confirmedGoneIds
}
