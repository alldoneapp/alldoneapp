import {
    buildConnectionId,
    CONNECTION_SERVICE_EMAIL,
    PROVIDER_GOOGLE,
    PROVIDER_MICROSOFT,
} from '../IntegrationProviders'

export function getGmailTaskData(taskOrGmailData) {
    if (!taskOrGmailData) return null
    if ('gmailData' in Object(taskOrGmailData)) return taskOrGmailData.gmailData
    return taskOrGmailData
}

export function getEmailTaskArchiveData(taskOrGmailData) {
    const gmailData = getGmailTaskData(taskOrGmailData)
    if (!gmailData) return null

    const messageIds = [
        ...(Array.isArray(gmailData.messageIds) ? gmailData.messageIds : []),
        gmailData.messageId,
    ].reduce((ids, messageId) => {
        const normalizedId = typeof messageId === 'string' ? messageId.trim() : ''
        if (normalizedId && !ids.includes(normalizedId)) ids.push(normalizedId)
        return ids
    }, [])
    if (messageIds.length === 0) return null

    const storedConnectionId = [gmailData.connectionId, gmailData.connectionProjectId, gmailData.projectId].find(
        value => typeof value === 'string' && value.trim()
    )
    const emailAddress =
        typeof (gmailData.gmailEmail || gmailData.email) === 'string'
            ? (gmailData.gmailEmail || gmailData.email).trim()
            : ''
    const provider = gmailData.provider === PROVIDER_MICROSOFT ? PROVIDER_MICROSOFT : PROVIDER_GOOGLE
    const connectionProjectId = storedConnectionId
        ? storedConnectionId.trim()
        : emailAddress
        ? buildConnectionId(CONNECTION_SERVICE_EMAIL, provider, emailAddress)
        : ''

    return connectionProjectId ? { connectionProjectId, messageIds } : null
}

export function isEmailLinkedTask(taskOrGmailData) {
    return !!getEmailTaskArchiveData(taskOrGmailData)
}

export function isGmailLabelFollowUpTask(taskOrGmailData) {
    const gmailData = getGmailTaskData(taskOrGmailData)
    return gmailData?.origin === 'gmail_label_follow_up' && !!gmailData?.messageId
}

export function isInboxSummaryGmailTask(taskOrGmailData) {
    const gmailData = getGmailTaskData(taskOrGmailData)
    return !!gmailData && !isGmailLabelFollowUpTask(gmailData)
}

export function getGmailTaskWebUrl(taskOrGmailData) {
    const gmailData = getGmailTaskData(taskOrGmailData)
    if (gmailData?.provider === 'microsoft') {
        return gmailData.webUrl || 'https://outlook.office.com/mail/'
    }
    const gmailEmail = gmailData?.gmailEmail || gmailData?.email
    const messageId = gmailData?.messageId
    let continueUrl = null

    if (gmailEmail && messageId) {
        continueUrl = `https://mail.google.com/mail/u/0/?authuser=${encodeURIComponent(
            gmailEmail
        )}#all/${encodeURIComponent(messageId)}`
    } else if (gmailData?.webUrl) {
        continueUrl = gmailData.webUrl
    } else if (gmailEmail) {
        continueUrl = `https://mail.google.com/mail/u/0/?authuser=${encodeURIComponent(gmailEmail)}`
    }

    if (!continueUrl) return null
    if (!gmailEmail) return continueUrl

    return `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
        gmailEmail
    )}&continue=${encodeURIComponent(continueUrl)}&service=mail`
}
