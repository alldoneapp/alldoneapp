// Pure selection logic behind `useGetUnreadChatMessages`, kept in its own module so it can be
// tested (and reused) without dragging the Firestore subscription - and therefore the whole
// BackendBridge import chain - into the test environment.

// Hard ceiling on how many unread comments a single chat subscribes to (four `in` queries of 30),
// so a thread with hundreds of unread comments cannot turn a chat list into an unbounded read.
// Beyond it the newest ones are kept.
export const UNREAD_MESSAGES_FETCH_LIMIT = 100

/**
 * The comment ids to subscribe to: the unread ids (oldest first, as `getUnreadCommentIds` returns
 * them), deduplicated, newest `UNREAD_MESSAGES_FETCH_LIMIT` only.
 *
 * Unread comments are NOT reliably the newest ones of a thread (AT-3149): in a "Daily emails" topic
 * newer emails are read or archived while an older one stays unread. So they are read by id, not
 * as "the newest N comments".
 */
export const getUnreadCommentIdsToWatch = unreadCommentIds => {
    const ids = [...new Set((unreadCommentIds || []).filter(id => typeof id === 'string' && id))]
    return ids.slice(-UNREAD_MESSAGES_FETCH_LIMIT)
}

const toMillis = value => {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
        const numeric = Number(value)
        if (Number.isFinite(numeric)) return numeric
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? parsed : 0
    }
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    if (value && typeof value.seconds === 'number') return value.seconds * 1000
    return 0
}

const messageTime = message => toMillis(message?.created) || toMillis(message?.lastChangeDate)

/**
 * Keeps only the comments the user has not read yet, in thread order (oldest first by creation
 * time; messages without a time keep the order they came in), so a preview lists them exactly as
 * the thread does. The by-id query returns them in document id order, hence the sort.
 */
export const selectUnreadMessages = (messages, unreadCommentIds) => {
    if (!unreadCommentIds || unreadCommentIds.length === 0) return []

    const unreadIds = new Set(unreadCommentIds)
    return (messages || [])
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => unreadIds.has(message?.id))
        .sort((a, b) => messageTime(a.message) - messageTime(b.message) || a.index - b.index)
        .map(({ message }) => message)
}
