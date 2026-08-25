import { getDb } from '../firestore'
import store from '../../../redux/store'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { awaitWriteAck } from '../offlineWriteAck'

const TOTAL_COUNT_KEYS = new Set(['totalFollowed', 'totalUnfollowed'])

const getLoggedUserId = () => store.getState()?.loggedUser?.uid || ''

const getNotificationRef = (projectId, userId, commentId) =>
    getDb().doc(`chatNotifications/${projectId}/${userId}/${commentId}`)

export function getCommentRefsFromLinkedEmails(linkedEmails = []) {
    const refs = []
    const seen = new Set()

    const addRef = ref => {
        if (!ref?.projectId || !ref?.commentId) return
        const key = `${ref.projectId}:${ref.commentId}`
        if (seen.has(key)) return
        seen.add(key)
        refs.push({
            projectId: ref.projectId,
            chatId: ref.chatId || '',
            commentId: ref.commentId,
        })
    }

    linkedEmails.forEach(email => {
        if (Array.isArray(email?.commentRefs)) email.commentRefs.forEach(addRef)
        addRef(email)
    })

    return refs
}

export function collectUnreadCommentRefs(projectChatNotifications = {}) {
    const refs = []

    Object.entries(projectChatNotifications || {}).forEach(([projectId, chats]) => {
        if (!projectId || !chats || typeof chats !== 'object') return

        Object.entries(chats).forEach(([chatId, notification]) => {
            if (!chatId || TOTAL_COUNT_KEYS.has(chatId)) return
            if (!notification || typeof notification !== 'object') return

            const commentIds = [
                ...(notification.followedCommentIds || []),
                ...(notification.unfollowedCommentIds || []),
            ]
            commentIds.forEach(commentId => {
                if (commentId) refs.push({ projectId, chatId, commentId })
            })
        })
    })

    return refs
}

export async function markChatCommentsAsRead(commentRefs = []) {
    const userId = getLoggedUserId()
    const uniqueRefs = getCommentRefsFromLinkedEmails(commentRefs)
    if (!userId || uniqueRefs.length === 0) return

    const batch = new BatchWrapper(getDb())
    uniqueRefs.forEach(({ projectId, commentId }) => {
        batch.delete(getNotificationRef(projectId, userId, commentId))
    })
    // The delete lands in the local cache the moment it is issued, which is what makes the
    // comment disappear from the unread list at once (AT-2424). Offline the server ack can
    // never arrive, so awaiting it bare would park every caller forever (AT-2340).
    await awaitWriteAck(batch.commit(), 'mark chat comments as read')
}

/**
 * The unread comment refs behind a set of linked emails, including the ones that can only be
 * found by matching the Gmail message id against the currently unread comments.
 *
 * Split out of `markAlldoneChatsReadForLinkedEmails` because AT-2424 has to know WHICH
 * notification docs it is about to delete before deleting them - that is the whole basis of
 * being able to put them back if the mailbox archive then fails.
 */
export async function resolveLinkedEmailCommentRefs(linkedEmails = []) {
    const directRefs = getCommentRefsFromLinkedEmails(linkedEmails)

    const emailsMissingCommentRefs = (linkedEmails || []).filter(
        email => email?.messageId && getCommentRefsFromLinkedEmails([email]).length === 0
    )
    if (emailsMissingCommentRefs.length === 0) return directRefs

    const matchedRefs = await matchCommentRefsByMessageIds(emailsMissingCommentRefs.map(email => email.messageId))
    return getCommentRefsFromLinkedEmails([...directRefs, ...matchedRefs])
}

async function matchCommentRefsByMessageIds(messageIds = []) {
    const uniqueMessageIds = [...new Set((messageIds || []).filter(Boolean))]
    if (uniqueMessageIds.length === 0) return []

    const messageIdSet = new Set(uniqueMessageIds)
    const unreadRefs = collectUnreadCommentRefs(store.getState().projectChatNotifications)
    if (unreadRefs.length === 0) return []

    return (
        await Promise.all(
            unreadRefs.map(async ref => {
                try {
                    const snapshot = await getDb()
                        .doc(`chatComments/${ref.projectId}/topics/${ref.chatId}/comments/${ref.commentId}`)
                        .get()
                    const messageId = snapshot.data()?.gmailData?.messageId
                    return messageId && messageIdSet.has(messageId) ? ref : null
                } catch (error) {
                    console.error('Failed to match archived email to an Alldone chat comment', error)
                    return null
                }
            })
        )
    ).filter(Boolean)
}

export async function markChatCommentsAsReadByMessageIds(messageIds = []) {
    await markChatCommentsAsRead(await matchCommentRefsByMessageIds(messageIds))
}

/**
 * Reads back what each notification doc holds, so a failed archive can put it back exactly as
 * it was (AT-2424).
 *
 * Read from the LOCAL CACHE, the `linkedParentsWrite` precedent: the whole
 * `chatNotifications/{projectId}/{userId}` collection is under a live `watchChatNotifications`
 * listener while this runs, so the cached copy is the current one, and a cache read costs no
 * round trip, no billed read and works offline - which matters because this sits directly on the
 * press. A ref we cannot read is simply left out: it is only ever used to restore, and restoring
 * a doc we never saw would be inventing unread state rather than preserving it.
 */
export async function captureChatNotifications(commentRefs = []) {
    const userId = getLoggedUserId()
    const uniqueRefs = getCommentRefsFromLinkedEmails(commentRefs)
    if (!userId || uniqueRefs.length === 0) return []

    return (
        await Promise.all(
            uniqueRefs.map(async ref => {
                try {
                    const snapshot = await getNotificationRef(ref.projectId, userId, ref.commentId).get({
                        source: 'cache',
                    })
                    if (!snapshot?.exists) return null
                    const data = snapshot.data()
                    return data ? { ...ref, data } : null
                } catch (error) {
                    // Not cached, or no cache at all. Nothing to restore for this one.
                    return null
                }
            })
        )
    ).filter(Boolean)
}

export async function restoreChatNotifications(captured = []) {
    const userId = getLoggedUserId()
    const entries = (captured || []).filter(entry => entry?.projectId && entry?.commentId && entry?.data)
    if (!userId || entries.length === 0) return

    const batch = new BatchWrapper(getDb())
    entries.forEach(({ projectId, commentId, data }) => {
        batch.set(getNotificationRef(projectId, userId, commentId), data)
    })
    await awaitWriteAck(batch.commit(), 'restore chat notifications')
}

/**
 * Clears the unread state of the chat comments behind these emails NOW, and hands back the
 * undo (AT-2424).
 *
 * Everything before the delete is local - a cache read per comment - so the notification docs are
 * gone from the local cache within the same tick as the press. That is what the unread list, the
 * per-row preview and every unread counter read from, so they update immediately instead of after
 * the ~4-8s the mailbox round trips take.
 *
 * The returned function is idempotent and never throws: it runs on a failure path where the
 * caller is already reporting an error, and a failing rollback must not replace that error with
 * a different one.
 */
export async function clearChatCommentsForLinkedEmails(linkedEmails = []) {
    const commentRefs = await resolveLinkedEmailCommentRefs(linkedEmails)
    const captured = await captureChatNotifications(commentRefs)

    await markChatCommentsAsRead(commentRefs)

    let restored = false
    return async () => {
        if (restored) return
        restored = true
        try {
            await restoreChatNotifications(captured)
        } catch (error) {
            console.error('Failed to restore the unread state of an email comment', error)
        }
    }
}

export async function markAlldoneChatsReadForLinkedEmails(linkedEmails = []) {
    await markChatCommentsAsRead(await resolveLinkedEmailCommentRefs(linkedEmails))
}
