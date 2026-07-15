import { getDb } from '../firestore'

export const VM_SESSION_STATUS_BUSY = 'busy'
export const VM_SESSION_STATUS_IDLE_RUNNING = 'idle_running'
export const VM_SESSION_STATUS_PAUSED = 'paused'

export const VM_SESSION_BADGE_ACTIVE = 'active'
export const VM_SESSION_BADGE_PAUSED = 'paused'

export function getVmSessionBadgeState(status) {
    if (status === VM_SESSION_STATUS_BUSY) return VM_SESSION_BADGE_ACTIVE
    if ([VM_SESSION_STATUS_IDLE_RUNNING, VM_SESSION_STATUS_PAUSED].includes(status)) {
        return VM_SESSION_BADGE_PAUSED
    }
    return null
}

export function getVmSessionDocId(projectId, objectId) {
    return `${projectId}__${objectId}`
}

export function watchVmSessionStatus(projectId, objectId, callback) {
    if (!projectId || !objectId) return () => {}

    const db = getDb()
    if (!db) {
        callback(null)
        return () => {}
    }

    return db.doc(`vmSessions/${getVmSessionDocId(projectId, objectId)}`).onSnapshot(
        snapshot => callback(snapshot.exists ? snapshot.data()?.status || null : null),
        () => callback(null)
    )
}
