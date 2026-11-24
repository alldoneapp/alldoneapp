import useGetMessages from './useGetMessages'
import { getUnreadMessagesFetchSize, selectUnreadMessages } from './unreadChatMessages'

/**
 * The unread comments of one chat, in thread order.
 *
 * Deliberately calls `useGetMessages` with `checkAssistant: false` and `showSpinner: false`: a chat
 * list row must not dispatch the global loading counter or auto-enable the assistant just because
 * it previewed something. It is also read-only - nothing here touches `chatNotifications`, so
 * rendering a preview never marks anything as read (AT-2256).
 */
export default function useGetUnreadChatMessages(projectId, chatId, chatType, unreadCommentIds) {
    const messages = useGetMessages(
        false,
        false,
        projectId,
        chatId,
        chatType,
        getUnreadMessagesFetchSize(unreadCommentIds)
    )

    return {
        messages: selectUnreadMessages(messages, unreadCommentIds),
        loaded: !!messages.loaded,
    }
}
