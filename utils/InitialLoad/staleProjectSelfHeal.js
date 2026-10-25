/**
 * Legacy entrypoint for stale project-id cleanup.
 *
 * Automatic pruning is intentionally disabled. Production proved that the full Firestore client
 * can report an existing project as absent even for `{ source: 'server' }` reads while still
 * reading the logged user's canary document successfully. On 2026-08-13 that combination removed
 * 14 live project memberships from the administrator's user document. A stale id is harmless;
 * deleting a live membership is not. Project deletion/member-removal flows already own the
 * authoritative cleanup and this boot path must remain read-only.
 */

/**
 * Ids of projects whose InitialLoad read SUCCEEDED but whose doc is gone. A failed read produces
 * a `null` entry (see `loadProjectsDataFromFirebase`) and must never become a prune candidate.
 */
export const getMissingProjectEntriesIds = loadResults =>
    (Array.isArray(loadResults) ? loadResults : [])
        .filter(entry => entry && entry.projectId && !entry.project)
        .map(entry => entry.projectId)

export const resetStaleProjectSelfHealForTests = () => {}

export async function pruneStaleProjectIds() {
    return []
}
