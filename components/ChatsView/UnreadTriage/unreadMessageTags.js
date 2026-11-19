import { stripMarkdownForPreview } from '../../../functions/Utils/parseTextUtils'
import { isMcpActor } from '../../../functions/shared/mcpActor'

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
// - Any other comment is from a person or from an assistant. A comment an MCP client (Claude Code,
//   Codex, ...) wrote in the user's name keeps the user as creator but carries `via: 'mcp'`
//   (functions/shared/mcpActor.js); it is an agent's message, so it counts as an assistant one.

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
    return message?.fromAssistant || isMcpActor(message) ? UNREAD_TAG_ASSISTANT : UNREAD_TAG_PEOPLE
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

// One line of plain text for the row's summary (the shared preview rule, see parseTextUtils).
export const toOneLineSummary = value => stripMarkdownForPreview(value)

// How much of a message a row previews (AT-3106, decided 2026-11-18): about three to four lines in
// the desktop column, and half that on a phone, where a line holds about half as many characters.
// Only the preview is shortened; the row's accessibility label and the opened chat keep the whole
// message.
export const UNREAD_SUMMARY_CHARACTER_LIMIT = 320
export const UNREAD_SUMMARY_CHARACTER_LIMIT_MOBILE = 160
export const UNREAD_SUMMARY_ELLIPSIS = '...'

export const getUnreadSummaryLimit = mobile =>
    mobile ? UNREAD_SUMMARY_CHARACTER_LIMIT_MOBILE : UNREAD_SUMMARY_CHARACTER_LIMIT

/**
 * The preview text of a row: the summary as it is when it fits, otherwise its first `limit`
 * characters cut at a word boundary and closed with "...". Counted in code points, so an emoji is
 * never split in half.
 *
 * The cut always falls between words, even when that drops a long last word: a mention, hashtag,
 * link or encoded image/attachment is one word (see stripMarkdownForPreview), and half of one would
 * render as a broken chip or a link to the wrong address. Only a preview without any space in its
 * first `limit` characters (one giant token) is cut inside the word.
 */
export const shortenUnreadSummary = (value, limit = UNREAD_SUMMARY_CHARACTER_LIMIT) => {
    const textValue = typeof value === 'string' ? value : ''
    const characters = Array.from(textValue)
    if (characters.length <= limit) return textValue

    let cut = characters.slice(0, limit).join('')
    // A cut right before a space already ends on a whole word.
    if (!/\s/.test(characters[limit])) {
        const lastSpace = cut.search(/\s\S*$/)
        if (lastSpace > 0) cut = cut.slice(0, lastSpace)
    }
    // No dangling separator in front of the dots ("word, ..." / "word -...").
    cut = cut.replace(/[\s.,;:!?\-–—]+$/u, '')
    return `${cut}${UNREAD_SUMMARY_ELLIPSIS}`
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
