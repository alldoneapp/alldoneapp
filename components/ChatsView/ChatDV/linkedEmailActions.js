import { buildConnectionId, CONNECTION_SERVICE_EMAIL, PROVIDER_GOOGLE } from '../../../utils/IntegrationProviders'

export function getLinkedEmailFromMessage(message = {}, context = {}) {
    const gmailData = message?.gmailData
    const messageId = typeof gmailData?.messageId === 'string' ? gmailData.messageId.trim() : ''
    const gmailEmail = typeof gmailData?.gmailEmail === 'string' ? gmailData.gmailEmail.trim().toLowerCase() : ''
    const connectionProjectId =
        typeof gmailData?.connectionId === 'string' && gmailData.connectionId.trim()
            ? gmailData.connectionId.trim()
            : typeof gmailData?.connectionProjectId === 'string' && gmailData.connectionProjectId.trim()
              ? gmailData.connectionProjectId.trim()
              : typeof gmailData?.projectId === 'string'
                ? gmailData.projectId.trim()
                : gmailEmail
                  ? buildConnectionId(CONNECTION_SERVICE_EMAIL, PROVIDER_GOOGLE, gmailEmail)
                  : ''

    if (!messageId || !connectionProjectId) return null

    const commentId = typeof message.id === 'string' ? message.id.trim() : ''
    const projectId = typeof context.projectId === 'string' ? context.projectId.trim() : ''
    const chatId = typeof context.chatId === 'string' ? context.chatId.trim() : ''
    const commentRefs =
        projectId && commentId
            ? [
                  {
                      projectId,
                      chatId,
                      commentId,
                  },
              ]
            : []

    return {
        key: `${connectionProjectId}:${messageId}`,
        connectionProjectId,
        messageId,
        ...(commentId ? { commentId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(chatId ? { chatId } : {}),
        ...(commentRefs.length ? { commentRefs } : {}),
    }
}

export function getLinkedEmailsFromMessages(messages = [], context = {}) {
    const linkedEmails = new Map()
    messages.forEach(message => {
        const linkedEmail = getLinkedEmailFromMessage(message, context)
        if (!linkedEmail) return

        const existing = linkedEmails.get(linkedEmail.key)
        if (!existing) {
            linkedEmails.set(linkedEmail.key, {
                ...linkedEmail,
                ...(linkedEmail.commentRefs ? { commentRefs: [...linkedEmail.commentRefs] } : {}),
            })
            return
        }

        if (!(linkedEmail.commentRefs || []).length) return
        existing.commentRefs = existing.commentRefs || []
        linkedEmail.commentRefs.forEach(ref => {
            if (
                !existing.commentRefs.some(
                    existingRef => existingRef.projectId === ref.projectId && existingRef.commentId === ref.commentId
                )
            ) {
                existing.commentRefs.push(ref)
            }
        })
    })
    return [...linkedEmails.values()]
}

// Informational email comments deliberately use unfollowed (grey) chat
// notifications. Keep the comment IDs so the UI can identify the individual
// emails that were unread when the thread was opened.
export function getNewEmailCommentIds(chatNotifications = {}) {
    const commentIds = Array.isArray(chatNotifications?.unfollowedCommentIds)
        ? chatNotifications.unfollowedCommentIds
        : []

    return [...new Set(commentIds.filter(Boolean))]
}

export function groupLinkedEmailsByConnection(linkedEmails = []) {
    return linkedEmails.reduce((groups, linkedEmail) => {
        if (!linkedEmail?.connectionProjectId || !linkedEmail?.messageId) return groups
        const messageIds = groups[linkedEmail.connectionProjectId] || []
        if (!messageIds.includes(linkedEmail.messageId)) messageIds.push(linkedEmail.messageId)
        groups[linkedEmail.connectionProjectId] = messageIds
        return groups
    }, {})
}

export async function archiveLinkedEmailsInMailbox(linkedEmails = []) {
    const groupedEmails = groupLinkedEmailsByConnection(linkedEmails)
    const { performEmailLineAction } = require('../../../utils/backends/EmailLine/emailLineBackend')
    await Promise.all(
        Object.entries(groupedEmails).map(([connectionProjectId, messageIds]) =>
            performEmailLineAction(connectionProjectId, { action: 'archive', messageIds })
        )
    )
}

// Chat and Email Line archive is "I'm done with this": take the mail out of the inbox and
// mark the matching Alldone chat comments as read. The mailbox read/unread state is left
// alone (AT-2298).
export async function archiveAndMarkReadLinkedEmails(linkedEmails = []) {
    const groupedEmails = groupLinkedEmailsByConnection(linkedEmails)
    if (Object.keys(groupedEmails).length === 0) return

    await archiveLinkedEmailsInMailbox(linkedEmails)
    const { markAlldoneChatsReadForLinkedEmails } = require('../../../utils/backends/Chats/markChatCommentsAsRead')
    await markAlldoneChatsReadForLinkedEmails(linkedEmails)
}
