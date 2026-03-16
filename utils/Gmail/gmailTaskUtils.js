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
