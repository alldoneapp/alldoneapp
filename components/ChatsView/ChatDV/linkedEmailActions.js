import { buildConnectionId, CONNECTION_SERVICE_EMAIL, PROVIDER_GOOGLE } from '../../../utils/IntegrationProviders'

export function getLinkedEmailFromMessage(message = {}) {
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

    return {
        key: `${connectionProjectId}:${messageId}`,
        connectionProjectId,
        messageId,
    }
}

export function getLinkedEmailsFromMessages(messages = []) {
    const linkedEmails = new Map()
    messages.forEach(message => {
        const linkedEmail = getLinkedEmailFromMessage(message)
        if (linkedEmail) linkedEmails.set(linkedEmail.key, linkedEmail)
    })
    return [...linkedEmails.values()]
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
