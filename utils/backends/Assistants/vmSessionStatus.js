import { getDb } from '../firestore'

export const VM_SESSION_STATUS_BUSY = 'busy'
export const VM_SESSION_STATUS_IDLE_RUNNING = 'idle_running'
export const VM_SESSION_STATUS_RUNNING = 'running'

const ACTIVE_OR_WARM_VM_SESSION_STATUSES = new Set([
    VM_SESSION_STATUS_BUSY,
    VM_SESSION_STATUS_IDLE_RUNNING,
    VM_SESSION_STATUS_RUNNING,
])

export function isVmSessionActiveOrWarm(status) {
    return ACTIVE_OR_WARM_VM_SESSION_STATUSES.has(status)
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
