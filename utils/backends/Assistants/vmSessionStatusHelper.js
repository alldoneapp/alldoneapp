export const VM_SESSION_STATUS_BUSY = 'busy'
export const VM_SESSION_STATUS_IDLE_RUNNING = 'idle_running'
export const VM_SESSION_STATUS_RUNNING = 'running'
export const VM_SESSION_STATUS_PAUSED = 'paused'
export const VM_SESSION_STATUS_FAILED = 'failed'

export const VM_BADGE_STATE_IN_PROGRESS = 'in_progress'
export const VM_BADGE_STATE_PAUSED = 'paused'
export const VM_BADGE_STATE_FAILED = 'failed'

const RESUMABLE_VM_SESSION_STATUSES = new Set([VM_SESSION_STATUS_IDLE_RUNNING, VM_SESSION_STATUS_PAUSED])

export function getVmSessionBadgeState(session) {
    if (!session) return null

    const status = typeof session === 'string' ? session : session.status
    if (status === VM_SESSION_STATUS_BUSY) return VM_BADGE_STATE_IN_PROGRESS
    if (status === VM_SESSION_STATUS_FAILED) return VM_BADGE_STATE_FAILED
    if (!RESUMABLE_VM_SESSION_STATUSES.has(status)) return null

    return typeof session === 'object' && session.lastRunStatus === VM_SESSION_STATUS_FAILED
        ? VM_BADGE_STATE_FAILED
        : VM_BADGE_STATE_PAUSED
}

export function getVmSessionDocId(projectId, objectId) {
    return `${projectId}__${objectId}`
}
