import firebase from 'firebase/compat/app'

const ACTIVITY_FEED_TABS = ['followed', 'all']

export const isUserAuthoredFeed = (feed, loggedUserId) =>
    !!loggedUserId && !!feed?.creatorId && feed.creatorId === loggedUserId

export const isNewComment = editingCommentId => !editingCommentId

export function queueObjectActivityFeedUnreadClear(db, batch, { projectId, userId, objectType, objectId }) {
    if (!projectId || !userId || !objectType || !objectId) return false

    const objectUnreadEntry = {
        [objectType]: { [objectId]: firebase.firestore.FieldValue.delete() },
    }

    ACTIVITY_FEED_TABS.forEach(tab => {
        batch.set(db.doc(`feedsCount/${projectId}/${userId}/${tab}`), objectUnreadEntry, { merge: true })
    })

    return true
}
