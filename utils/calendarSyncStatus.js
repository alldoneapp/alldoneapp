/**
 * AT-3136 — the outcome of this session's calendar pulls, per connected project.
 *
 * `checkIfCalendarConnected` (utils/backends/firestore.js) is the client's only calendar pull and
 * used to swallow its result. The meeting-time line needs to know whether the meetings it sums were
 * refreshed: a sync that is still running or has failed must not be presented as a verified number.
 *
 * Statuses: 'syncing' while the callable runs, 'synced' after success, 'failed' after an error.
 * A project that was never pulled in this session has no entry. Module state, not redux: nothing
 * persists it and only the one header line listens.
 */

export const CALENDAR_SYNC_SYNCING = 'syncing'
export const CALENDAR_SYNC_SYNCED = 'synced'
export const CALENDAR_SYNC_FAILED = 'failed'

let statusByProjectId = {}
const listeners = new Set()

export const getCalendarSyncStatuses = () => statusByProjectId

export const setCalendarSyncStatus = (projectId, status) => {
    if (!projectId || statusByProjectId[projectId] === status) return
    statusByProjectId = { ...statusByProjectId, [projectId]: status }
    listeners.forEach(listener => listener(statusByProjectId))
}

export const subscribeToCalendarSyncStatus = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/** Test helper. */
export const resetCalendarSyncStatuses = () => {
    statusByProjectId = {}
    listeners.forEach(listener => listener(statusByProjectId))
}

/**
 * The combined state of the given connected projects: 'failed' if any pull failed, else 'syncing'
 * if any is running, else 'synced' when every one was pulled in this session. Projects not pulled in
 * this session yet make it 'unknown': their meetings come from the server's daily sync and are shown
 * as they are, without claiming a fresh pull.
 */
export const CALENDAR_SYNC_UNKNOWN = 'unknown'

export const summarizeCalendarSyncStatus = (projectIds, statuses = statusByProjectId) => {
    if (!projectIds || projectIds.length === 0) return null
    const values = projectIds.map(projectId => statuses[projectId])
    if (values.includes(CALENDAR_SYNC_FAILED)) return CALENDAR_SYNC_FAILED
    if (values.includes(CALENDAR_SYNC_SYNCING)) return CALENDAR_SYNC_SYNCING
    if (values.every(value => value === CALENDAR_SYNC_SYNCED)) return CALENDAR_SYNC_SYNCED
    return CALENDAR_SYNC_UNKNOWN
}
