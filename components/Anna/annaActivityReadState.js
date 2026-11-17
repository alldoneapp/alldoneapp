import store from '../../redux/store'
import { getDb } from '../../utils/backends/firestore'
import { BatchWrapper } from '../../functions/BatchWrapper/batchWrapper'
import { awaitWriteAck, isAppOffline } from '../../utils/backends/offlineWriteAck'
import { markChatMessagesAsRead } from '../../utils/backends/Chats/chatReadNotifications'
import { queueObjectActivityFeedUnreadClear } from '../../utils/backends/Feeds/activityFeedReadState'
import { getAnnaActivityReadTargets } from './annaActivityReadTargets'

// AT-3075: "Mark as read" on an Assistant-mode activity card. It clears exactly what opening the
// item would clear, through the same persisted read state the app's red badges read, so the card's
// edge, the chat bubble and every unread counter move together. Nothing is hidden locally:
//   chat/{projectId}/{chatId}/{commentId}            -> the whole chat, as opening it does
//                                                      (`markChatMessagesAsRead`, ChatBoard/RichCommentModal)
//   feed/{projectId}/{objectType}/{objectId}/{feedId} -> the object's Updates entries, as
//                                                      interacting with it does (`queueObjectActivityFeedUnreadClear`)

export async function markAnnaActivityRead(notices = []) {
    const userId = store.getState()?.loggedUser?.uid
    const { chats, feeds } = getAnnaActivityReadTargets(notices)
    if (!userId || chats.length + feeds.length === 0) return
    // Clearing a chat also asks the server to retire its email/push notifications; offline that
    // half cannot run, so the action fails fast rather than half-applying (offline.md).
    if (isAppOffline()) {
        const error = new Error('Mark as read needs a connection')
        error.code = 'offline'
        throw error
    }

    const work = chats.map(({ projectId, chatId }) => markChatMessagesAsRead(projectId, chatId))
    if (feeds.length) {
        const db = getDb()
        const batch = new BatchWrapper(db)
        feeds.forEach(feed => queueObjectActivityFeedUnreadClear(db, batch, { ...feed, userId }))
        work.push(awaitWriteAck(batch.commit(), 'mark Anna activity as read'))
    }
    // Every target is attempted; a failure of one does not keep the others unread.
    const failure = (await Promise.allSettled(work)).find(result => result.status === 'rejected')
    if (failure) throw failure.reason
}
