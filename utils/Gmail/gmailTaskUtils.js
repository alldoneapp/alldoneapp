export function getGmailTaskData(taskOrGmailData) {
    if (!taskOrGmailData) return null
    if ('gmailData' in Object(taskOrGmailData)) return taskOrGmailData.gmailData
    return taskOrGmailData
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
    if (gmailData?.webUrl) return gmailData.webUrl

    const gmailEmail = gmailData?.gmailEmail || gmailData?.email
    if (!gmailEmail) return null

    return 'https://mail.google.com/mail/u/' + encodeURIComponent(gmailEmail)
}

export function cleanGmailFollowUpTaskTitle(title, taskOrGmailData) {
    const trimmedTitle = typeof title === 'string' ? title.trim() : ''
    const gmailData = getGmailTaskData(taskOrGmailData)
    const webUrl = getGmailTaskWebUrl(gmailData)

    if (!trimmedTitle || !isGmailLabelFollowUpTask(gmailData) || !webUrl) return trimmedTitle

    let sanitizedTitle = trimmedTitle.replace(webUrl, ' ')
    sanitizedTitle = sanitizedTitle.replace(/^(email|e-mail|mail)\s+/i, '')
    sanitizedTitle = sanitizedTitle.replace(/^[:\-|]+\s*/i, '')
    sanitizedTitle = sanitizedTitle.replace(/\s+[:\-|]\s+/g, ': ')
    sanitizedTitle = sanitizedTitle.replace(/\s+/g, ' ').trim()

    return sanitizedTitle || trimmedTitle
}
