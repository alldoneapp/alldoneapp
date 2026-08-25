import { getDb } from '../firestore'
import { markServerContact, startConnectionLatencySample } from '../../connectionHealth'

/**
 * Users and contacts are stored in the same following document. Reading both through
 * one listener avoids opening two identical Firestore targets for every project.
 */
export const watchFollowedPeople = (
    projectId,
    userId,
    callback,
    { trackConnectionHealth = false, onInitialSnapshot } = {}
) => {
    let finishLatencySample = trackConnectionHealth ? startConnectionLatencySample('followed_contacts_snapshot') : null
    let initialSnapshotDelivered = false
    const finishSample = () => {
        if (!finishLatencySample) return
        finishLatencySample()
        finishLatencySample = null
    }
    const unsubscribe = getDb()
        .doc(`usersFollowing/${projectId}/entries/${userId}`)
        .onSnapshot(
            { includeMetadataChanges: true },
            doc => {
                if (!doc.metadata?.fromCache) {
                    finishSample()
                    markServerContact('snapshot')
                }
                const data = doc.data() || {}
                callback(projectId, {
                    userIds: Object.keys(data.users || {}),
                    contactIds: Object.keys(data.contacts || {}),
                })
                if (!initialSnapshotDelivered) {
                    initialSnapshotDelivered = true
                    onInitialSnapshot?.(projectId)
                }
            },
            error => {
                finishSample()
                console.error('watchFollowedPeople: onSnapshot error', { projectId, userId, error })
                if (!initialSnapshotDelivered) {
                    initialSnapshotDelivered = true
                    onInitialSnapshot?.(projectId)
                }
            }
        )
    return () => {
        finishSample()
        unsubscribe()
    }
}
