import { getDb } from '../firestore'

/**
 * Users and contacts are stored in the same following document. Reading both through
 * one listener avoids opening two identical Firestore targets for every project.
 */
export const watchFollowedPeople = (projectId, userId, callback) =>
    getDb()
        .doc(`usersFollowing/${projectId}/entries/${userId}`)
        .onSnapshot(doc => {
            const data = doc.data() || {}
            callback(projectId, {
                userIds: Object.keys(data.users || {}),
                contactIds: Object.keys(data.contacts || {}),
            })
        })
