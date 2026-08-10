import { getDb, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { ALL_TAB, FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

export const watchChatsAmount = (projectId, watcherKey, callback, activeTab) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId } = loggedUser

    let query = getDb().collection(`chatObjects/${projectId}/chats`)
    query =
        activeTab === ALL_TAB
            ? query.where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
            : query.where('usersFollowing', 'array-contains', loggedUserId)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(snapshot => {
        callback(snapshot.docs.length)
    })
}

export const unwatchChatsAmount = watcherKey => {
    globalWatcherUnsub[watcherKey]()
}

export const watchChatsMessagesAmount = (projectId, chatType, objectId, watcherKey, callback) => {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`chatComments/${projectId}/${chatType}/${objectId}/comments`)
        .onSnapshot(snapshot => {
            callback(snapshot.docs.length)
        })
}

export const unwatchChatsMessagesAmount = watcherKey => {
    globalWatcherUnsub[watcherKey]()
}
