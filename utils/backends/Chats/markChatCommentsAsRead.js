import { getDb } from '../firestore'
import store from '../../../redux/store'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'

const TOTAL_COUNT_KEYS = new Set(['totalFollowed', 'totalUnfollowed'])

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
    const { loggedUser } = store.getState()
    const userId = loggedUser?.uid
    const uniqueRefs = getCommentRefsFromLinkedEmails(commentRefs)
    if (!userId || uniqueRefs.length === 0) return

    const batch = new BatchWrapper(getDb())
    uniqueRefs.forEach(({ projectId, commentId }) => {
        batch.delete(getDb().doc(`chatNotifications/${projectId}/${userId}/${commentId}`))
    })
    await batch.commit()
}

export async function markChatCommentsAsReadByMessageIds(messageIds = []) {
    const uniqueMessageIds = [...new Set((messageIds || []).filter(Boolean))]
    if (uniqueMessageIds.length === 0) return

    const messageIdSet = new Set(uniqueMessageIds)
    const unreadRefs = collectUnreadCommentRefs(store.getState().projectChatNotifications)
    if (unreadRefs.length === 0) return

    const matchingRefs = (
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

    await markChatCommentsAsRead(matchingRefs)
}

export async function markAlldoneChatsReadForLinkedEmails(linkedEmails = []) {
    const commentRefs = getCommentRefsFromLinkedEmails(linkedEmails)
    await markChatCommentsAsRead(commentRefs)

    const emailsMissingCommentRefs = (linkedEmails || []).filter(
        email => email?.messageId && getCommentRefsFromLinkedEmails([email]).length === 0
    )
    if (emailsMissingCommentRefs.length === 0) return

    await markChatCommentsAsReadByMessageIds(emailsMissingCommentRefs.map(email => email.messageId))
}
