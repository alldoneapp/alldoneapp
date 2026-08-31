import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { FOLLOWED_TAB } from '../../../components/Feeds/Utils/FeedsConstants'
import store from '../../../redux/store'
import { getDb, runHttpsCallableFunction } from '../firestore'
import { awaitWriteAck } from '../offlineWriteAck'

const commitDeletes = async (docs, label) => {
    if (!docs?.length) return

    const db = getDb()
    const batch = new BatchWrapper(db)
    docs.forEach(snapshot => batch.delete(snapshot.ref || db.doc(snapshot.path)))
    await awaitWriteAck(batch.commit(), label)
}

/**
 * Clears one chat's unread state for the signed-in user.
 *
 * chatNotifications lives below the signed-in user's id, so its delete is safe and gives the UI an
 * immediate local-cache update. Recipient email/push notifications cannot be queried reliably by
 * the web rules, and a missing direct email document is denied, so their cleanup is server-owned.
 */
export async function markChatMessagesAsRead(projectId, chatId) {
    const userId = store.getState()?.loggedUser?.uid
    if (!projectId || !chatId || !userId) return

    const db = getDb()
    const chatNotificationsQuery = db
        .collection(`chatNotifications/${projectId}/${userId}`)
        .where('chatId', '==', chatId)
    const chatSnapshot = await chatNotificationsQuery.get()

    await Promise.all([
        commitDeletes(chatSnapshot.docs, 'mark chat notification as read'),
        runHttpsCallableFunction('markChatNotificationsReadSecondGen', { projectId, chatId }),
    ])
}

/** Clears every matching unread entry for the signed-in user in one project. */
export async function markMessagesAsRead(projectId, requestedUserId, chatsActiveTab) {
    const userId = store.getState()?.loggedUser?.uid
    if (!projectId || !userId) return

    if (requestedUserId && requestedUserId !== userId) {
        console.warn('[chat read] Ignoring a stale unread owner id', { projectId, requestedUserId })
    }

    let chatNotificationsQuery = getDb().collection(`chatNotifications/${projectId}/${userId}`)
    if (chatsActiveTab === FOLLOWED_TAB) {
        chatNotificationsQuery = chatNotificationsQuery.where('followed', '==', true)
    }
    const chatSnapshot = await chatNotificationsQuery.get()

    await Promise.all([
        commitDeletes(chatSnapshot.docs, 'mark project chat notifications as read'),
        runHttpsCallableFunction('markChatNotificationsReadSecondGen', {
            projectId,
            followedOnly: chatsActiveTab === FOLLOWED_TAB,
        }),
    ])
}
