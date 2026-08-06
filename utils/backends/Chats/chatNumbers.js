import { getDb, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { ALL_TAB, FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

/**
 * Caps the chats-amount query at `visibleAmount + 1` documents.
 *
 * The only consumer of this amount (`ChatsByProject`) never displays it: it just compares it
 * against the number of chats it currently renders (`toRender`) to decide whether to show the
 * "show more" / "collapse" buttons. Every one of those comparisons is preserved when the amount
 * saturates at `visibleAmount + 1`, because for `capped = min(real, R + 1)`:
 *   - `real > R`   <=> `capped > R`
 *   - `real >= R`  <=> `capped >= R`
 *   - `real < R`   <=> `capped < R`
 *
 * Without the cap this listener downloads *every* chat document of the project just to count them.
 * On an "All Projects" screen that is one unbounded listener per project (12.5k+ documents /
 * ~16 MB for a large account), which starved the bounded chat listeners that gate the loading
 * spinner. See AT-2162.
 */
export const getChatsAmountQueryLimit = visibleAmount =>
    Number.isFinite(visibleAmount) && visibleAmount > 0 ? visibleAmount + 1 : null

export const watchChatsAmount = (projectId, watcherKey, callback, activeTab, visibleAmount) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId } = loggedUser

    let query = getDb().collection(`chatObjects/${projectId}/chats`)
    query =
        activeTab === ALL_TAB
            ? query.where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
            : query.where('usersFollowing', 'array-contains', loggedUserId)

    const limit = getChatsAmountQueryLimit(visibleAmount)
    if (limit !== null) query = query.limit(limit)

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
