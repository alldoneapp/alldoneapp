import getAllProjectsOpenTasksAmount from './getAllProjectsOpenTasksAmount'

export const TODAY_INBOX_UNKNOWN = 'unknown'
export const TODAY_INBOX_OPEN = 'open'
export const TODAY_INBOX_EMPTY = 'empty'

/**
 * AT-3057 — is the logged user's inbox for today empty across all projects, open, or not known yet?
 *
 * Reads the same store slice as the Home badge, the All Projects button and `useReachEmptyInbox`:
 * `sidebarNumbers`, the UNFILTERED count of today's and overdue open top-level tasks per project
 * and user (`watchSidebarTasksAmount`). Future tasks are not in it, so they never keep today's inbox
 * open; board filters and the selected project never reach it either, so neither can fake an
 * empty inbox. Archived and template projects are left out exactly like the Home badge does.
 *
 * A count of 0 is also what "not counted yet" looks like (AT-2445), so EMPTY needs proof that the
 * count is complete:
 * - `sidebarNumbers.loading` is absent. It is `true` in the initial store and while any project's
 *   listener has not delivered its first snapshot, and `false` after `clearSidebarTasksAmount`
 *   (logout / teardown), which is "no data", not "loaded".
 * - every project of the user has an entry. `updateSidebarNumbers` writes one for every watched
 *   project, so a missing entry means the counts still describe an older, smaller project list
 *   (the watcher is rebuilt when the list changes and keeps the old counts until it reports).
 * Anything else is UNKNOWN, and callers must treat UNKNOWN like OPEN: never celebrate on it.
 */
export function getTodayInboxState({ sidebarNumbers, userId, projectIds, archivedProjectIds, templateProjectIds }) {
    if (!userId || !sidebarNumbers || typeof sidebarNumbers !== 'object') return TODAY_INBOX_UNKNOWN
    const amount = getAllProjectsOpenTasksAmount(sidebarNumbers, userId, archivedProjectIds, templateProjectIds)
    // A positive count is an answer even while another project is still loading.
    if (amount > 0) return TODAY_INBOX_OPEN
    if (sidebarNumbers.loading !== undefined) return TODAY_INBOX_UNKNOWN
    if (!Array.isArray(projectIds) || projectIds.length === 0) return TODAY_INBOX_UNKNOWN
    if (projectIds.some(projectId => !sidebarNumbers[projectId])) return TODAY_INBOX_UNKNOWN
    return TODAY_INBOX_EMPTY
}

/** Redux selector form: returns one of the three string constants, so it is stable between renders. */
export const selectTodayInboxState = state =>
    getTodayInboxState({
        sidebarNumbers: state.sidebarNumbers,
        userId: state.loggedUser?.uid,
        projectIds: (state.loggedUserProjects || []).map(project => project?.id).filter(Boolean),
        archivedProjectIds: state.loggedUser?.archivedProjectIds || [],
        templateProjectIds: state.loggedUser?.templateProjectIds || [],
    })
