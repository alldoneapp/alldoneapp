import { useEffect, useState } from 'react'
import v4 from 'uuid/v4'

import { watchCommentsByIds } from '../../utils/backends/Chats/watchCommentsByIds'
import { unwatch } from '../../utils/backends/firestore'
import { getUnreadCommentIdsToWatch, selectUnreadMessages } from './unreadChatMessages'

/**
 * The unread comments of one chat, in thread order.
 *
 * Subscribes to the unread comments by id (AT-3149). It used to read the newest "unread + 5"
 * comments and keep the unread ones, which lost every unread comment that newer, already read
 * comments had pushed out of that window - the Unread chip then counted more messages than the
 * Unread list (and the chat row preview) showed.
 *
 * Read-only: nothing here touches `chatNotifications`, so rendering a preview never marks anything
 * as read (AT-2256). No global loading spinner and no assistant default, as before.
 */
export default function useGetUnreadChatMessages(projectId, chatId, chatType, unreadCommentIds) {
    const idsToWatch = getUnreadCommentIdsToWatch(unreadCommentIds)
    const idsKey = idsToWatch.join('|')
    const scope = JSON.stringify([projectId, chatType, chatId])
    const [state, setState] = useState({ scope, messages: [], loaded: false })
    // Another chat starts empty. Within the same chat the last messages stay while a changed set of
    // ids re-subscribes; `selectUnreadMessages` below already drops the ones no longer unread.
    const current = state.scope === scope ? state : { scope, messages: [], loaded: false }

    useEffect(() => {
        if (!projectId || !chatId || !chatType || idsToWatch.length === 0) {
            setState({ scope, messages: [], loaded: true })
            return
        }

        const watcherKey = v4()
        watchCommentsByIds(projectId, chatType, chatId, idsToWatch, watcherKey, comments => {
            setState({ scope, messages: comments, loaded: true })
        })
        return () => unwatch(watcherKey)
    }, [scope, idsKey])

    return {
        messages: selectUnreadMessages(current.messages, idsToWatch),
        loaded: current.loaded,
    }
}
