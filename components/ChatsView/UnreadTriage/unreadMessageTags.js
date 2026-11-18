// The unread list (Chats > Unread): one row per unread message, each with a tag the user can filter
// by. Pure helpers only - no redux, no Firestore - so the rules are testable on their own.
//
// Where a tag comes from:
// - An email comment (written by the Gmail labeling sync) carries `gmailData.labelKey` (the label
//   the classifier picked; the built-in "ads" label, a custom "newsletter" label, or a project) and
//   `gmailData.emailKind` (person / newsletter / notification / ads). The label wins because the
//   user configured it; the same rule decides the server's auto-archive
//   (functions/Gmail/unreadEmailSettings.js `resolveUnreadEmailKind`). Comments from before these
//   fields existed have neither and fall back to "Emails".
// - Any other comment is from a person or from an assistant.

export const UNREAD_TAG_ALL = 'all'
export const UNREAD_TAG_PEOPLE = 'people'
export const UNREAD_TAG_ASSISTANT = 'assistant'
export const UNREAD_TAG_NOTIFICATION = 'notification'
export const UNREAD_TAG_NEWSLETTER = 'newsletter'
export const UNREAD_TAG_ADS = 'ads'
export const UNREAD_TAG_EMAIL = 'email'

export const UNREAD_TAG_ORDER = [
    UNREAD_TAG_PEOPLE,
    UNREAD_TAG_ASSISTANT,
    UNREAD_TAG_NOTIFICATION,
    UNREAD_TAG_NEWSLETTER,
    UNREAD_TAG_ADS,
    UNREAD_TAG_EMAIL,
]

// Translation keys (en/de/es) of the filter chips and row tags.
export const UNREAD_TAG_LABEL_KEYS = {
    [UNREAD_TAG_ALL]: 'All',
    [UNREAD_TAG_PEOPLE]: 'From people',
    [UNREAD_TAG_ASSISTANT]: 'Assistant messages',
    [UNREAD_TAG_NOTIFICATION]: 'Notifications',
    [UNREAD_TAG_NEWSLETTER]: 'Newsletters',
    [UNREAD_TAG_ADS]: 'Ads',
    [UNREAD_TAG_EMAIL]: 'Other emails',
}

export const UNREAD_SORT_NEWEST = 'newest'
export const UNREAD_SORT_SENDER = 'sender'

const EMAIL_KIND_TAGS = {
    person: UNREAD_TAG_PEOPLE,
    newsletter: UNREAD_TAG_NEWSLETTER,
    notification: UNREAD_TAG_NOTIFICATION,
    ads: UNREAD_TAG_ADS,
}

const text = value => (typeof value === 'string' ? value.trim() : '')

// An incoming email linked from the labeling sync. The owner's own sent mail is never unread, and
// a comment without a Gmail message id is an ordinary chat message.
export const isEmailMessage = message =>
    !!text(message?.gmailData?.messageId) &&
    message.source !== 'gmail_thread_sent' &&
    !(message.gmailData.direction === 'outgoing' && message.fromAssistant === false)

export const getUnreadMessageTag = message => {
    if (isEmailMessage(message)) {
        const labelKey = text(message.gmailData.labelKey).toLowerCase()
        if (labelKey === 'ads') return UNREAD_TAG_ADS
        if (labelKey === 'newsletter') return UNREAD_TAG_NEWSLETTER
        return EMAIL_KIND_TAGS[text(message.gmailData.emailKind)] || UNREAD_TAG_EMAIL
    }
    return message?.fromAssistant ? UNREAD_TAG_ASSISTANT : UNREAD_TAG_PEOPLE
}

// The labeling sync writes informational emails as "Email from [sender name] ([sender email]):
// [one-line summary]" (functions/Gmail/serverSideGmailLabelingSync.js). Older comments carry no
// structured sender, so the row reads it back from that line.
const EMAIL_LINE_PATTERN =
    /^\s*(?:LINK:\s*)?(?:E-?mail|Mail)\s+(?:from|von|de)\s+(.*?)\s*[(<[]\s*([^\s()<>[\]]+@[^\s()<>[\]]+)\s*[)>\]]\s*[:\-–]?\s*([\s\S]*)$/i

export const parseEmailCommentLine = commentText => {
    const match = text(commentText).match(EMAIL_LINE_PATTERN)
    if (!match) return null
    return { senderName: text(match[1]), senderEmail: text(match[2]).toLowerCase(), summary: text(match[3]) }
}

/**
 * Sender and one-line summary of an email row. Structured fields win (written since the unread
 * list exists); the comment line is the fallback. When nothing parses, the whole comment is the
 * summary and the sender is unknown - the row still works, it just shows "Email".
 */
export const getEmailRowContent = message => {
    const parsed = parseEmailCommentLine(message?.commentText)
    const senderEmail = text(message?.gmailData?.fromEmail) || parsed?.senderEmail || ''
    const senderName = text(message?.gmailData?.fromName) || parsed?.senderName || senderEmail
    return { senderName, senderEmail, summary: parsed ? parsed.summary : text(message?.commentText) }
}

export const getMessageTime = message => {
    const toMs = value => {
        if (typeof value === 'number') return value
        if (value && typeof value.toMillis === 'function') return value.toMillis()
        if (value && typeof value.seconds === 'number') return value.seconds * 1000
        return 0
    }
    return toMs(message?.created) || toMs(message?.lastChangeDate)
}

export const countRowsByTag = rows =>
    rows.reduce(
        (counts, row) => {
            counts[row.tag] = (counts[row.tag] || 0) + 1
            counts[UNREAD_TAG_ALL] += 1
            return counts
        },
        { [UNREAD_TAG_ALL]: 0 }
    )

export const filterRowsByTag = (rows, tag) =>
    !tag || tag === UNREAD_TAG_ALL ? rows : rows.filter(row => row.tag === tag)

// Newest first; by sender is alphabetical, and newest first within one sender.
export const sortRows = (rows, sortMode) =>
    [...rows].sort((a, b) => {
        if (sortMode === UNREAD_SORT_SENDER) {
            const bySender = (a.senderName || '').localeCompare(b.senderName || '', undefined, {
                sensitivity: 'base',
            })
            if (bySender !== 0) return bySender
        }
        return b.time - a.time
    })
