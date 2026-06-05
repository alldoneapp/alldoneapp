'use strict'

const crypto = require('crypto')

const DEFAULT_PUBLIC_EMAIL = 'anna@alldoneapp.com'
const DEFAULT_ASSISTANT_EMAIL_ADDRESSES = [DEFAULT_PUBLIC_EMAIL, 'anna@alldone.app', 'noreply@alldone.app']
const DEFAULT_EMAIL_SIGNATURE = '---\nAnna Alldone\nAI Chief of Staff\nhttps://alldone.app/'
const EMAIL_EXTERNAL_TOOLS_KEY = 'external_tools'
const EMAIL_CREATE_TASK_KEY = 'create_task'
const EMAIL_FIND_CALENDAR_AVAILABILITY_KEY = 'find_calendar_availability'
const EMAIL_SEARCH_CALENDAR_EVENTS_KEY = 'search_calendar_events'
const EMAIL_CREATE_CALENDAR_EVENT_KEY = 'create_calendar_event'
const EMAIL_CREATE_NOTE_KEY = 'create_note'
const EMAIL_UPDATE_NOTE_KEY = 'update_note'
const EMAIL_UPDATE_HEARTBEAT_SETTINGS_KEY = 'update_heartbeat_settings'
const EMAIL_CREATE_GMAIL_DRAFT_KEY = 'create_gmail_draft'
const EMAIL_CREATE_GMAIL_REPLY_DRAFT_KEY = 'create_gmail_reply_draft'
const EMAIL_SAFE_ACTION_CONTEXT_CALENDAR_AVAILABILITY = 'calendar_availability'
const MAX_EMAIL_EXTRACTED_TEXT_LENGTH = 8000

function normalizeEmailAddress(value = '') {
    const normalized = String(value || '').trim()
    const angleMatch = normalized.match(/<([^>]+)>/)
    const candidate = angleMatch?.[1] || normalized
    return String(candidate || '')
        .trim()
        .toLowerCase()
}

function splitEmailHeaderEntries(value = '') {
    const input = String(value || '').trim()
    if (!input) return []

    const entries = []
    let current = ''
    let insideQuotes = false
    let angleDepth = 0

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index]

        if (char === '"' && input[index - 1] !== '\\') {
            insideQuotes = !insideQuotes
            current += char
            continue
        }

        if (!insideQuotes) {
            if (char === '<') {
                angleDepth += 1
            } else if (char === '>' && angleDepth > 0) {
                angleDepth -= 1
            } else if (char === ',' && angleDepth === 0) {
                const normalizedEntry = current.trim()
                if (normalizedEntry) entries.push(normalizedEntry)
                current = ''
                continue
            }
        }

        current += char
    }

    const normalizedEntry = current.trim()
    if (normalizedEntry) entries.push(normalizedEntry)

    return entries
}

function normalizeEmailDisplayName(value = '') {
    const normalized = String(value || '')
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/\s+/g, ' ')
        .trim()

    if (!normalized) return ''
    if (/^[^@\s]+@[^@\s]+$/.test(normalized)) return ''
    return normalized
}

function parseEmailHeaderEntry(value = '') {
    const raw = String(value || '').trim()
    if (!raw) return null

    const email = normalizeEmailAddress(raw)
    if (!email) return null

    const angleMatch = raw.match(/^(.*?)<[^>]+>\s*$/)
    const displayName = normalizeEmailDisplayName(angleMatch?.[1] || '')

    return { raw, email, displayName }
}

function parseEmailHeaderAddresses(value = '') {
    return splitEmailHeaderEntries(value).map(parseEmailHeaderEntry).filter(Boolean)
}

function isValidEmailAddress(value = '') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function normalizeEmailAddressList(values = []) {
    const rawValues = Array.isArray(values) ? values : [values]
    const normalized = []

    rawValues.forEach(value => {
        const raw = typeof value === 'object' && value ? value.email || value.address || '' : value
        parseEmailHeaderAddresses(raw).forEach(entry => {
            if (isValidEmailAddress(entry.email) && !normalized.includes(entry.email)) {
                normalized.push(entry.email)
            }
        })
    })

    return normalized
}

function buildReplyAllRecipients({ fromEmail, toEmails = [], ccEmails = [], assistantEmailAddresses = [] } = {}) {
    const excluded = new Set(
        normalizeEmailAddressList([...DEFAULT_ASSISTANT_EMAIL_ADDRESSES, ...assistantEmailAddresses])
    )
    const normalizedFrom = normalizeEmailAddressList(fromEmail)[0] || ''
    const replyToEmails = []
    const replyCcEmails = []

    const append = (target, email) => {
        if (!email || excluded.has(email) || replyToEmails.includes(email) || replyCcEmails.includes(email)) return
        target.push(email)
    }

    append(replyToEmails, normalizedFrom)
    normalizeEmailAddressList(toEmails).forEach(email => append(replyToEmails, email))
    normalizeEmailAddressList(ccEmails).forEach(email => append(replyCcEmails, email))

    return {
        toEmails: replyToEmails,
        ccEmails: replyCcEmails,
    }
}

function buildCurrentEmailParticipants({ fromEmail, toEmails = [], ccEmails = [], assistantEmailAddresses = [] } = {}) {
    const excluded = new Set(
        normalizeEmailAddressList([...DEFAULT_ASSISTANT_EMAIL_ADDRESSES, ...assistantEmailAddresses])
    )
    const normalizedToEmails = normalizeEmailAddressList(toEmails).filter(email => !excluded.has(email))
    const normalizedCcEmails = normalizeEmailAddressList(ccEmails).filter(
        email => !excluded.has(email) && !normalizedToEmails.includes(email)
    )

    return {
        senderEmail: normalizeEmailAddressList(fromEmail)[0] || '',
        toEmails: normalizedToEmails,
        ccEmails: normalizedCcEmails,
    }
}

function normalizeSafeEmailActionContext(value = {}) {
    if (value?.type !== EMAIL_SAFE_ACTION_CONTEXT_CALENDAR_AVAILABILITY) return null

    const options = (Array.isArray(value.options) ? value.options : [])
        .map(option => ({
            start: typeof option?.start === 'string' ? option.start : '',
            end: typeof option?.end === 'string' ? option.end : '',
        }))
        .filter(option => option.start && option.end)
        .slice(0, 10)
    if (options.length === 0) return null

    const normalized = {
        type: EMAIL_SAFE_ACTION_CONTEXT_CALENDAR_AVAILABILITY,
        options,
    }
    if (typeof value.timeZone === 'string' && value.timeZone.trim()) normalized.timeZone = value.timeZone.trim()
    if (Number.isFinite(value.durationMinutes)) normalized.durationMinutes = value.durationMinutes
    if (value.requestedRange && typeof value.requestedRange === 'object') {
        const start = typeof value.requestedRange.start === 'string' ? value.requestedRange.start : ''
        const end = typeof value.requestedRange.end === 'string' ? value.requestedRange.end : ''
        if (start && end) normalized.requestedRange = { start, end }
    }
    if (Number.isFinite(value.createdAt)) normalized.createdAt = value.createdAt
    return normalized
}

function getEmailSafeAllowedTools(rawTools = []) {
    if (!Array.isArray(rawTools)) return []

    const allowed = []
    if (rawTools.includes(EMAIL_CREATE_TASK_KEY)) allowed.push(EMAIL_CREATE_TASK_KEY)
    if (
        rawTools.includes(EMAIL_FIND_CALENDAR_AVAILABILITY_KEY) ||
        rawTools.includes(EMAIL_SEARCH_CALENDAR_EVENTS_KEY)
    ) {
        allowed.push(EMAIL_FIND_CALENDAR_AVAILABILITY_KEY)
    }
    if (rawTools.includes(EMAIL_CREATE_CALENDAR_EVENT_KEY)) allowed.push(EMAIL_CREATE_CALENDAR_EVENT_KEY)
    if (rawTools.includes(EMAIL_CREATE_NOTE_KEY)) allowed.push(EMAIL_CREATE_NOTE_KEY)
    if (rawTools.includes(EMAIL_UPDATE_NOTE_KEY)) allowed.push(EMAIL_UPDATE_NOTE_KEY)
    if (rawTools.includes(EMAIL_UPDATE_HEARTBEAT_SETTINGS_KEY)) {
        allowed.push(EMAIL_UPDATE_HEARTBEAT_SETTINGS_KEY)
    }
    if (rawTools.includes(EMAIL_CREATE_GMAIL_DRAFT_KEY)) allowed.push(EMAIL_CREATE_GMAIL_DRAFT_KEY)
    if (rawTools.includes(EMAIL_CREATE_GMAIL_REPLY_DRAFT_KEY)) {
        allowed.push(EMAIL_CREATE_GMAIL_REPLY_DRAFT_KEY)
    }
    if (rawTools.includes(EMAIL_EXTERNAL_TOOLS_KEY)) allowed.push(EMAIL_EXTERNAL_TOOLS_KEY)
    return allowed
}

function buildDailyEmailTitle(firstName = 'User', dateLabel = '', assistantName = 'Anna') {
    return `Daily email ${String(assistantName || 'Anna').trim() || 'Anna'} <> ${
        String(firstName || 'User').trim() || 'User'
    } ${String(dateLabel || '').trim()}`.trim()
}

function buildDailyEmailParticipantEmails(values = [], assistantEmailAddresses = []) {
    const excluded = new Set(
        normalizeEmailAddressList([...DEFAULT_ASSISTANT_EMAIL_ADDRESSES, ...assistantEmailAddresses])
    )

    return normalizeEmailAddressList(values)
        .filter(email => !excluded.has(email))
        .sort()
}

function buildDailyEmailParticipantKey(participantEmails = []) {
    return crypto
        .createHash('sha256')
        .update(buildDailyEmailParticipantEmails(participantEmails).join('\n'))
        .digest('hex')
        .substring(0, 24)
}

function getEmailParticipantDisplayName(value = '') {
    const email = normalizeEmailAddress(value)
    const localPart = String(email.split('@')[0] || '')
        .split('+')[0]
        .replace(/[._-]+/g, ' ')
        .replace(/[^a-z0-9' ]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    if (!localPart) return email.substring(0, 60)

    return localPart
        .split(' ')
        .filter(Boolean)
        .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
        .join(' ')
        .substring(0, 60)
}

function buildParticipantScopedDailyEmailTitle({
    ownerFirstName = 'User',
    ownerEmail = '',
    participantEmails = [],
    assistantName = 'Anna',
    dateLabel = '',
} = {}) {
    const normalizedOwnerEmail = normalizeEmailAddress(ownerEmail)
    const normalizedParticipantEmails = buildDailyEmailParticipantEmails(participantEmails)
    const normalizedOwnerFirstName = String(ownerFirstName || 'User').trim() || 'User'

    if (normalizedParticipantEmails.length <= 1) {
        return buildDailyEmailTitle(normalizedOwnerFirstName, dateLabel, assistantName)
    }

    const otherParticipantNames = normalizedParticipantEmails
        .filter(email => email !== normalizedOwnerEmail)
        .map(getEmailParticipantDisplayName)
        .filter(Boolean)
        .sort((first, second) => first.localeCompare(second))
    const participantNames = [normalizedOwnerFirstName, ...otherParticipantNames].filter(Boolean)

    return `Daily email ${String(assistantName || 'Anna').trim() || 'Anna'} <> ${participantNames.join(', ')} ${String(
        dateLabel || ''
    ).trim()}`.trim()
}

function stripHtmlToText(html = '') {
    return String(html || '')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
}

function trimQuotedReplyText(text = '') {
    const normalized = String(text || '')
        .replace(/\r/g, '')
        .trim()
    if (!normalized) return ''

    const patterns = [
        /^\s*On .+ wrote:\s*$/im,
        /^\s*From:\s.+$/im,
        /^\s*Sent:\s.+$/im,
        /^\s*To:\s.+$/im,
        /^\s*Subject:\s.+$/im,
        /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
        /^\s*Begin forwarded message:\s*$/im,
        /^\s*>+/im,
    ]

    let cutIndex = normalized.length
    patterns.forEach(pattern => {
        const match = pattern.exec(normalized)
        if (match && typeof match.index === 'number') {
            cutIndex = Math.min(cutIndex, match.index)
        }
    })

    return normalized.slice(0, cutIndex).trim()
}

function looksLikeForwardedEmail(subject = '', body = '') {
    const normalizedSubject = String(subject || '').trim()
    const normalizedBody = String(body || '').replace(/\r/g, '')

    if (/^\s*fwd?:/i.test(normalizedSubject)) return true

    return [
        /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
        /^\s*Begin forwarded message:\s*$/im,
        /^\s*Attachments:\s*$/im,
    ].some(pattern => pattern.test(normalizedBody))
}

function buildEmailCommentText(subject = '', textBody = '', htmlBody = '') {
    const normalizedSubject = String(subject || '').trim()
    const rawBody = String(textBody || '').trim() || stripHtmlToText(htmlBody)
    const normalizedBody = looksLikeForwardedEmail(normalizedSubject, rawBody)
        ? rawBody.trim()
        : trimQuotedReplyText(rawBody)

    if (normalizedSubject && normalizedBody) {
        return `Subject: ${normalizedSubject}\n\n${normalizedBody}`
    }

    if (normalizedSubject) return `Subject: ${normalizedSubject}`
    return normalizedBody
}

function getSupportedAttachmentPriority(attachment = {}) {
    const fileName = String(attachment.fileName || '').toLowerCase()
    const contentType = String(attachment.contentType || attachment.mimeType || '').toLowerCase()

    if (contentType.includes('application/pdf') || fileName.endsWith('.pdf')) return 1
    if (
        contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
        fileName.endsWith('.docx')
    ) {
        return 2
    }
    if (
        contentType.startsWith('text/') ||
        contentType.includes('application/json') ||
        contentType.includes('application/csv') ||
        contentType.includes('text/csv') ||
        fileName.endsWith('.txt') ||
        fileName.endsWith('.csv') ||
        fileName.endsWith('.json') ||
        fileName.endsWith('.md')
    ) {
        return 3
    }

    return 0
}

const INVOICE_LIKE_PATTERNS = [
    /\binvoice\b/i,
    /\brechnung\b/i,
    /\bfactura\b/i,
    /\bfaktura\b/i,
    /\breceipt\b/i,
    /\bbill(?:ing)?\b/i,
    /\bstatement\b/i,
    /\bcredit[ _-]?note\b/i,
    /\bdebit[ _-]?note\b/i,
    /\bpayment[ _-]?request\b/i,
]

const INVOICE_CONTENT_PATTERNS = [
    /\binvoice\b/i,
    /\binvoice\s*(?:number|no\.?|#)\b/i,
    /\bamount\s+due\b/i,
    /\bdue\s+date\b/i,
    /\btotal\b/i,
    /\bsubtotal\b/i,
    /\bvat\b/i,
    /\btax\b/i,
    /\biban\b/i,
    /\bbic\b/i,
    /\baccount\s+number\b/i,
    /\bpayment\s+terms\b/i,
    /\bnet\s+\d+\b/i,
]

const NON_ACTIONABLE_PATTERNS = [
    /\blogo\b/i,
    /\bsignature\b/i,
    /\bbrand(?:ing)?\b/i,
    /\bbanner\b/i,
    /\bicon\b/i,
    /\bheader\b/i,
    /\bfooter\b/i,
    /\bimage\b/i,
    /\bphoto\b/i,
    /\bscan\d*\b/i,
]

function getAttachmentRelevanceScore(attachment = {}) {
    const fileName = String(attachment.fileName || '').trim()
    const extractedText = String(attachment.extractedText || '').trim()
    const priority = getSupportedAttachmentPriority(attachment)
    if (priority <= 0) return -Infinity

    let score = (4 - priority) * 100

    INVOICE_LIKE_PATTERNS.forEach(pattern => {
        if (pattern.test(fileName)) score += 40
    })

    INVOICE_CONTENT_PATTERNS.forEach(pattern => {
        if (pattern.test(extractedText)) score += 15
    })

    NON_ACTIONABLE_PATTERNS.forEach(pattern => {
        if (pattern.test(fileName)) score -= 30
    })

    return score
}

function pickActionableAttachment(attachments = []) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return { status: 'none', attachment: null, supportedAttachments: [] }
    }

    const supportedAttachments = attachments
        .map((attachment, index) => {
            const priority = getSupportedAttachmentPriority(attachment)
            return {
                ...attachment,
                priority,
                originalIndex: index,
                relevanceScore: priority > 0 ? getAttachmentRelevanceScore(attachment) : -Infinity,
            }
        })
        .filter(attachment => attachment.priority > 0)
        .sort((a, b) => {
            if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
            if (a.priority !== b.priority) return a.priority - b.priority
            return a.originalIndex - b.originalIndex
        })

    if (supportedAttachments.length === 0) {
        return { status: 'none', attachment: null, supportedAttachments: [] }
    }

    return { status: 'ok', attachment: supportedAttachments[0], supportedAttachments }
}

function summarizeAttachments(attachments = []) {
    if (!Array.isArray(attachments) || attachments.length === 0) return []

    return attachments.map(attachment => ({
        fileName: attachment.fileName || '',
        contentType: attachment.contentType || attachment.mimeType || '',
        sizeBytes: Number(attachment.sizeBytes || 0) || 0,
        extractedText: String(attachment.extractedText || '').substring(0, MAX_EMAIL_EXTRACTED_TEXT_LENGTH),
        extractionStatus: attachment.extractionStatus || '',
        storagePath: attachment.storagePath || '',
    }))
}

function buildAttachmentSummaryForComment(attachments = []) {
    if (!Array.isArray(attachments) || attachments.length === 0) return ''

    const lines = attachments.map(attachment => {
        const fileName = attachment.fileName || 'attachment'
        const contentType = attachment.contentType || attachment.mimeType || 'unknown'
        const extractionStatus = attachment.extractionStatus || 'not_processed'
        return `${fileName} (${contentType}, ${extractionStatus})`
    })

    return `Attachments:\n- ${lines.join('\n- ')}`
}

function computeWebhookSignature(secret, timestamp, payload) {
    if (!secret) return ''
    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload || {})
    return crypto.createHmac('sha256', secret).update(`${timestamp}.${payloadString}`).digest('hex')
}

function verifyInboundEmailSignature(secret, signature = {}, payload) {
    if (!secret) return { valid: false, reason: 'missing_secret' }

    const timestamp = String(signature?.timestamp || '').trim()
    const value = String(signature?.value || '').trim()
    if (!timestamp || !value) return { valid: false, reason: 'missing_signature_fields' }

    const expected = computeWebhookSignature(secret, timestamp, payload)
    if (!expected) return { valid: false, reason: 'missing_expected_signature' }

    try {
        const providedBuffer = Buffer.from(value, 'hex')
        const expectedBuffer = Buffer.from(expected, 'hex')
        if (providedBuffer.length !== expectedBuffer.length) {
            return { valid: false, reason: 'signature_length_mismatch' }
        }
        const valid = crypto.timingSafeEqual(providedBuffer, expectedBuffer)
        return valid ? { valid: true } : { valid: false, reason: 'signature_mismatch' }
    } catch (error) {
        return { valid: false, reason: error.message || 'signature_parse_error' }
    }
}

module.exports = {
    DEFAULT_ASSISTANT_EMAIL_ADDRESSES,
    DEFAULT_EMAIL_SIGNATURE,
    DEFAULT_PUBLIC_EMAIL,
    EMAIL_CREATE_CALENDAR_EVENT_KEY,
    EMAIL_CREATE_GMAIL_DRAFT_KEY,
    EMAIL_CREATE_GMAIL_REPLY_DRAFT_KEY,
    EMAIL_CREATE_NOTE_KEY,
    EMAIL_CREATE_TASK_KEY,
    EMAIL_EXTERNAL_TOOLS_KEY,
    EMAIL_FIND_CALENDAR_AVAILABILITY_KEY,
    EMAIL_SAFE_ACTION_CONTEXT_CALENDAR_AVAILABILITY,
    EMAIL_UPDATE_NOTE_KEY,
    buildAttachmentSummaryForComment,
    buildCurrentEmailParticipants,
    buildDailyEmailParticipantEmails,
    buildDailyEmailParticipantKey,
    buildDailyEmailTitle,
    buildEmailCommentText,
    buildParticipantScopedDailyEmailTitle,
    buildReplyAllRecipients,
    computeWebhookSignature,
    getEmailParticipantDisplayName,
    getEmailSafeAllowedTools,
    normalizeEmailAddress,
    normalizeEmailAddressList,
    normalizeEmailDisplayName,
    normalizeSafeEmailActionContext,
    parseEmailHeaderAddresses,
    pickActionableAttachment,
    looksLikeForwardedEmail,
    splitEmailHeaderEntries,
    stripHtmlToText,
    trimQuotedReplyText,
    summarizeAttachments,
    verifyInboundEmailSignature,
}
