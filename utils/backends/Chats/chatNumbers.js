import { getDb, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import { getChatAccessQueryArgs } from './chatAccessQuery'

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
 * On an "All Projects" screen that is one unbounded listener per project, which starved the bounded
 * chat listeners that gate the loading spinner. See AT-2162.
 *
 * Measured against production (alldonealeph) for the reporting user, who mounts 14 project sections
 * (see the note in ChatsView.js on why that number is small): these listeners pulled 11,042 chat
 * documents - 3,255 from a single project - to display 44 chats. Capped at `toRender + 1` with the
 * account's `numberChatsAllTeams` of 3, the same screen reads 56 documents.
 */
export const getChatsAmountQueryLimit = visibleAmount =>
    Number.isFinite(visibleAmount) && visibleAmount > 0 ? visibleAmount + 1 : null

export const watchChatsAmount = (projectId, watcherKey, callback, activeTab, visibleAmount) => {
    const { loggedUser } = store.getState()
    const { uid: loggedUserId, isAnonymous } = loggedUser

    let query = getDb().collection(`chatObjects/${projectId}/chats`)
    query = query.where(...getChatAccessQueryArgs({ activeTab, loggedUserId, isAnonymous }))

    const limit = getChatsAmountQueryLimit(visibleAmount)
    if (limit !== null) query = query.limit(limit)

    globalWatcherUnsub[watcherKey] = query.onSnapshot(
        snapshot => {
            callback(snapshot.docs.length)
        },
        error => {
            // The amount only controls Show more/Collapse. If a project disappears during a
            // membership transition, degrade to zero instead of leaving an uncaught listener.
            if (process.env.NODE_ENV !== 'production') {
                console.warn(`Unable to watch chat amount for ${projectId}:`, error)
            }
            callback(0)
        }
    )
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
