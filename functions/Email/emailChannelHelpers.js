'use strict'

const crypto = require('crypto')

const DEFAULT_PUBLIC_EMAIL = 'anna@alldone.app'
const EMAIL_EXTERNAL_TOOLS_KEY = 'external_tools'
const EMAIL_CREATE_TASK_KEY = 'create_task'
const EMAIL_CREATE_CALENDAR_EVENT_KEY = 'create_calendar_event'
const EMAIL_CREATE_NOTE_KEY = 'create_note'
const EMAIL_UPDATE_NOTE_KEY = 'update_note'
const EMAIL_CREATE_GMAIL_DRAFT_KEY = 'create_gmail_draft'
const EMAIL_CREATE_GMAIL_REPLY_DRAFT_KEY = 'create_gmail_reply_draft'
const MAX_EMAIL_EXTRACTED_TEXT_LENGTH = 8000

function normalizeEmailAddress(value = '') {
    const normalized = String(value || '').trim()
    const angleMatch = normalized.match(/<([^>]+)>/)
    const candidate = angleMatch?.[1] || normalized
    return String(candidate || '')
        .trim()
        .toLowerCase()
}

function getEmailSafeAllowedTools(rawTools = []) {
    if (!Array.isArray(rawTools)) return []

    const allowed = []
    if (rawTools.includes(EMAIL_CREATE_TASK_KEY)) allowed.push(EMAIL_CREATE_TASK_KEY)
    if (rawTools.includes(EMAIL_CREATE_CALENDAR_EVENT_KEY)) allowed.push(EMAIL_CREATE_CALENDAR_EVENT_KEY)
    if (rawTools.includes(EMAIL_CREATE_NOTE_KEY)) allowed.push(EMAIL_CREATE_NOTE_KEY)
    if (rawTools.includes(EMAIL_UPDATE_NOTE_KEY)) allowed.push(EMAIL_UPDATE_NOTE_KEY)
    if (rawTools.includes(EMAIL_CREATE_GMAIL_DRAFT_KEY)) allowed.push(EMAIL_CREATE_GMAIL_DRAFT_KEY)
    if (rawTools.includes(EMAIL_CREATE_GMAIL_REPLY_DRAFT_KEY)) {
        allowed.push(EMAIL_CREATE_GMAIL_REPLY_DRAFT_KEY)
    }
    if (rawTools.includes(EMAIL_EXTERNAL_TOOLS_KEY)) allowed.push(EMAIL_EXTERNAL_TOOLS_KEY)
    return allowed
}

function buildDailyEmailTitle(firstName = 'User', dateLabel = '') {
    return `Daily email <> ${String(firstName || 'User').trim() || 'User'} ${String(dateLabel || '').trim()}`.trim()
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

function pickActionableAttachment(attachments = []) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return { status: 'none', attachment: null, supportedAttachments: [] }
    }

    const supportedAttachments = attachments
        .map(attachment => ({ ...attachment, priority: getSupportedAttachmentPriority(attachment) }))
        .filter(attachment => attachment.priority > 0)
        .sort((a, b) => a.priority - b.priority)

    if (supportedAttachments.length === 0) {
        return { status: 'none', attachment: null, supportedAttachments: [] }
    }

    if (supportedAttachments.length > 1) {
        return { status: 'multiple_supported', attachment: null, supportedAttachments }
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
    DEFAULT_PUBLIC_EMAIL,
    EMAIL_CREATE_CALENDAR_EVENT_KEY,
    EMAIL_CREATE_GMAIL_DRAFT_KEY,
    EMAIL_CREATE_GMAIL_REPLY_DRAFT_KEY,
    EMAIL_CREATE_NOTE_KEY,
    EMAIL_CREATE_TASK_KEY,
    EMAIL_EXTERNAL_TOOLS_KEY,
    EMAIL_UPDATE_NOTE_KEY,
    buildAttachmentSummaryForComment,
    buildDailyEmailTitle,
    buildEmailCommentText,
    computeWebhookSignature,
    getEmailSafeAllowedTools,
    normalizeEmailAddress,
    pickActionableAttachment,
    looksLikeForwardedEmail,
    stripHtmlToText,
    trimQuotedReplyText,
    summarizeAttachments,
    verifyInboundEmailSignature,
}
