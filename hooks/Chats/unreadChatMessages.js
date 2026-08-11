// Pure selection logic behind `useGetUnreadChatMessages`, kept in its own module so it can be
// tested (and reused) without dragging the Firestore subscription - and therefore the whole
// BackendBridge import chain - into the test environment.

// Unread comments are, in practice, the newest ones in a thread: a notification doc is written when
// the comment is created and `markChatMessagesAsRead` deletes the whole chat's docs at once. Pulling
// a few extra comments beyond the unread count absorbs the rare exception (a single notification
// removed on its own, e.g. a VM status comment) without widening the query for every chat.
export const UNREAD_MESSAGES_FETCH_BUFFER = 5

// Hard ceiling on the comment window a single chat row may open, so a thread with hundreds of
// unread comments cannot turn a chat list into an unbounded read.
export const UNREAD_MESSAGES_FETCH_LIMIT = 100

export const getUnreadMessagesFetchSize = unreadCommentIds =>
    Math.min(UNREAD_MESSAGES_FETCH_LIMIT, (unreadCommentIds?.length || 0) + UNREAD_MESSAGES_FETCH_BUFFER)

/**
 * Keeps only the comments the user has not read yet, preserving the order `useGetMessages` produced
 * (strictly chronological by creation time) so a preview lists them exactly as the thread does.
 */
export const selectUnreadMessages = (messages, unreadCommentIds) => {
    if (!unreadCommentIds || unreadCommentIds.length === 0) return []

    const unreadIds = new Set(unreadCommentIds)
    return (messages || []).filter(message => unreadIds.has(message?.id))
}
