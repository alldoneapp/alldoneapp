import firebase from 'firebase/compat/app'

import { queueSummaryFeedObjectClear } from './activityUnreadSummary'

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
    // The badge reads the user's activity summary; clear it in the same batch (own summary only).
    queueSummaryFeedObjectClear(batch, userId, projectId, objectType, objectId)

    return true
}
