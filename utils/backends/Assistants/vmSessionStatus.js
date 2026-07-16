import { getDb } from '../firestore'
import { getVmSessionDocId } from './vmSessionStatusHelper'

export * from './vmSessionStatusHelper'

export function watchVmSessionStatus(projectId, objectId, callback) {
    if (!projectId || !objectId) return () => {}

    const db = getDb()
    if (!db) {
        callback(null)
        return () => {}
    }

    return db.doc(`vmSessions/${getVmSessionDocId(projectId, objectId)}`).onSnapshot(
        snapshot => callback(snapshot.exists ? snapshot.data() || null : null),
        () => callback(null)
    )
}
