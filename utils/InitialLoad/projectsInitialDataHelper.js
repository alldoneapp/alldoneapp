/**
 * Pure helpers to validate/normalize the raw project payloads that the login flow loads
 * (from Firebase or from the localStorage startup cache) before they are pushed into redux.
 *
 * Why this exists: `loadInitialData()` used to assume every entry of that array was a fully
 * loaded project and wrote `project.index = index` directly on it. A project document that no
 * longer exists (deleted project, membership revoked, stale cached `projectIds`) makes
 * `getProjectData()` resolve to `null`, so the entry is `{ project: null, users: [...], ... }`.
 * That entry survived the old `data !== null` filter and threw
 * `TypeError: Cannot set properties of null (setting 'index')`, which aborted login entirely.
 *
 * Keep this module free of redux/firestore imports so it stays cheap to unit test.
 */

export const INVALID_ENTRY_REASONS = {
    MISSING_ENTRY: 'missing-entry',
    MISSING_PROJECT: 'missing-project',
    MISSING_PROJECT_ID: 'missing-project-id',
}

const toArray = value => (Array.isArray(value) ? value : [])

/**
 * Reason why an entry cannot be used, or null when the entry is usable.
 */
export function getInvalidProjectEntryReason(entry) {
    if (!entry || typeof entry !== 'object') return INVALID_ENTRY_REASONS.MISSING_ENTRY
    const { project } = entry
    if (!project || typeof project !== 'object') return INVALID_ENTRY_REASONS.MISSING_PROJECT
    if (!project.id) return INVALID_ENTRY_REASONS.MISSING_PROJECT_ID
    return null
}

export function isValidProjectEntry(entry) {
    return getInvalidProjectEntryReason(entry) === null
}

/**
 * True when the payload holds one usable entry per requested project. Used to decide whether a
 * payload is good enough to be written to (or read from) the 24h startup cache: caching a
 * partially failed load poisons every subsequent startup until the cache expires.
 */
export function isCompleteProjectsInitialData(projectsInitialData, expectedProjectCount) {
    if (!Array.isArray(projectsInitialData)) return false
    if (typeof expectedProjectCount === 'number' && projectsInitialData.length !== expectedProjectCount) return false
    return projectsInitialData.every(isValidProjectEntry)
}

/**
 * Copies the project (never mutates the cached/stored object) and stamps its display index.
 * Missing sub-collections are normalized to arrays because the consumers iterate them.
 */
function normalizeProjectEntry(entry, index) {
    return {
        project: { ...entry.project, index },
        users: toArray(entry.users),
        contacts: toArray(entry.contacts),
        workstreams: toArray(entry.workstreams),
        assistants: toArray(entry.assistants),
    }
}

/**
 * Splits the raw payload into usable entries (with `project.index` assigned by position) and a
 * diagnostic list of everything that was dropped.
 *
 * @param projectsInitialData raw array as returned by the loader or read from the cache
 * @param projectIds ids in the same order, used to name the offending project in diagnostics
 * @param logger injectable for tests
 */
export function sanitizeProjectsInitialData(projectsInitialData, projectIds = [], logger = console) {
    const entries = Array.isArray(projectsInitialData) ? projectsInitialData : []
    const ids = Array.isArray(projectIds) ? projectIds : []

    const validEntries = []
    const invalidEntries = []

    entries.forEach((entry, index) => {
        const reason = getInvalidProjectEntryReason(entry)
        if (reason === null) {
            validEntries.push(normalizeProjectEntry(entry, validEntries.length))
            return
        }

        invalidEntries.push({
            index,
            reason,
            // `projectId` is stamped on every entry by the loader; older cached payloads don't
            // have it, so fall back to positional lookup in the id list.
            projectId: (entry && entry.projectId) || ids[index] || null,
        })
    })

    if (invalidEntries.length > 0 && logger && typeof logger.error === 'function') {
        logger.error(
            '[InitialLoad] Dropped malformed project data during login initialization. ' +
                'Login continues with the remaining projects.',
            {
                droppedCount: invalidEntries.length,
                totalCount: entries.length,
                requestedProjectIds: ids.length,
                dropped: invalidEntries,
            }
        )
    }

    return { validEntries, invalidEntries }
}

/**
 * Order-insensitive comparison of two id lists WITHOUT mutating either of them.
 * The previous inline check called `.sort()` on the caller's arrays, which reordered
 * `loggedUser.projectIds` inside the redux state as a side effect of a cache lookup.
 */
export function haveSameProjectIds(idsA, idsB) {
    if (!Array.isArray(idsA) || !Array.isArray(idsB)) return false
    if (idsA.length !== idsB.length) return false
    const sortedA = [...idsA].sort()
    const sortedB = [...idsB].sort()
    return sortedA.every((id, index) => id === sortedB[index])
}
