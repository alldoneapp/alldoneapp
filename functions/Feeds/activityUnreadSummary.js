/**
 * Mirrors a user's per-project unread state into ONE document the client can watch.
 *
 * The badges read two per-project sources: `feedsCount/{projectId}/{userId}/{followed|all}` (the
 * Updates counters) and `chatNotifications/{projectId}/{userId}/{commentId}` (unread comments).
 * Watching them directly costs three live Firestore listeners per project; on the dogfooding
 * account that was 39 of the ~320 listeners a boot opened, for documents that hold a few hundred
 * bytes in total. The summary at `users/{userId}/private/activityUnreadSummary` carries the same
 * data verbatim:
 *
 *   feeds.{projectId}.{tab}         = the feedsCount document's data
 *   chats.{projectId}.{commentId}   = the chatNotifications document's data
 *   bootstrapped.{projectId}        = true once the client has copied that project's pre-existing
 *                                     state in (see utils/backends/Feeds/activityUnreadSummary.js)
 *
 * Every writer of the two sources keeps working unchanged; these triggers are what keeps the
 * summary current. Each one RE-READS its source document instead of trusting the event payload:
 * Eventarc may deliver two writes to the same document out of order, and a stale payload applied
 * last would leave a badge wrong until the next write. A re-read is always at least as new as the
 * write that caused it, so whichever trigger runs last writes the current state.
 */
const admin = require('firebase-admin')
const { FieldPath, FieldValue } = require('firebase-admin/firestore')

const SUMMARY_DOC_ID = 'activityUnreadSummary'
const MIRROR_VERSION = 1
const FEED_TABS = new Set(['followed', 'all'])

const getSummaryRef = (db, userId) => db.doc(`users/${userId}/private/${SUMMARY_DOC_ID}`)

// Workstreams share the user-id slot in these paths but are not accounts; a summary under
// users/ws@…/private would be a document nobody reads.
const isMirroredUserId = userId => typeof userId === 'string' && userId.length > 0 && !userId.startsWith('ws@')

const writeSummaryEntry = async (db, userId, path, value) => {
    const ref = getSummaryRef(db, userId)
    const [root, projectId, key] = path
    // mirrorVersion is what tells the client a live mirror exists; only these triggers write it.
    if (value === null) {
        await ref.set(
            { mirrorVersion: MIRROR_VERSION, [root]: { [projectId]: { [key]: FieldValue.delete() } } },
            { merge: true }
        )
    } else {
        // mergeFields REPLACES exactly this entry. A plain merge would merge the maps recursively
        // and keep counters the source has since removed.
        await ref.set(
            { mirrorVersion: MIRROR_VERSION, [root]: { [projectId]: { [key]: value } } },
            { mergeFields: [new FieldPath('mirrorVersion'), new FieldPath(...path)] }
        )
    }
}

async function mirrorFeedsCount({ projectId, userId, tab }, db = admin.firestore()) {
    if (!FEED_TABS.has(tab) || !isMirroredUserId(userId)) return false
    const snapshot = await db.doc(`feedsCount/${projectId}/${userId}/${tab}`).get()
    await writeSummaryEntry(db, userId, ['feeds', projectId, tab], snapshot.exists ? snapshot.data() || {} : null)
    return true
}

async function mirrorChatNotification({ projectId, userId, commentId }, db = admin.firestore()) {
    if (!isMirroredUserId(userId)) return false
    const snapshot = await db.doc(`chatNotifications/${projectId}/${userId}/${commentId}`).get()
    await writeSummaryEntry(db, userId, ['chats', projectId, commentId], snapshot.exists ? snapshot.data() || {} : null)
    return true
}

module.exports = {
    MIRROR_VERSION,
    SUMMARY_DOC_ID,
    isMirroredUserId,
    mirrorFeedsCount,
    mirrorChatNotification,
}
