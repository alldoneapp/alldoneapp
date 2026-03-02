'use strict'

function decodeBase64Url(input = '') {
    if (!input || typeof input !== 'string') return ''

    const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4
    const padded = padding === 0 ? normalized : normalized + '='.repeat(4 - padding)

    return Buffer.from(padded, 'base64').toString('utf8')
}

function stripHtml(html = '') {
    if (!html) return ''

    return html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
}

function getHeaderValue(headers = [], name = '') {
    const targetName = typeof name === 'string' ? name.toLowerCase() : ''
    const header = headers.find(item => (item?.name || '').toLowerCase() === targetName)
    return header?.value || ''
}

function collectBodyParts(payload, parts = []) {
    if (!payload) return parts

    const mimeType = payload.mimeType || ''
    const data = payload.body?.data || ''

    if (data && mimeType) {
        parts.push({
            mimeType,
            text: decodeBase64Url(data),
        })
    }

    if (Array.isArray(payload.parts)) {
        payload.parts.forEach(part => collectBodyParts(part, parts))
    }

    return parts
}

function extractBodyText(payload) {
    const parts = collectBodyParts(payload, [])
    const plainTextPart = parts.find(part => part.mimeType === 'text/plain' && part.text.trim())
    if (plainTextPart) return plainTextPart.text.trim()

    const htmlTextPart = parts.find(part => part.mimeType === 'text/html' && part.text.trim())
    if (htmlTextPart) return stripHtml(htmlTextPart.text)

    return ''
}

function normalizeGmailMessage(message = {}, maxBodyLength = 8000) {
    const payload = message.payload || {}
    const headers = Array.isArray(payload.headers) ? payload.headers : []
    const bodyText = extractBodyText(payload).slice(0, maxBodyLength)

    return {
        messageId: message.id || '',
        threadId: message.threadId || '',
        historyId: message.historyId || '',
        internalDate: Number(message.internalDate || 0),
        labelIds: Array.isArray(message.labelIds) ? message.labelIds : [],
        from: getHeaderValue(headers, 'From'),
        to: getHeaderValue(headers, 'To'),
        cc: getHeaderValue(headers, 'Cc'),
        subject: getHeaderValue(headers, 'Subject'),
        date: getHeaderValue(headers, 'Date'),
        snippet: typeof message.snippet === 'string' ? message.snippet : '',
        bodyText,
    }
}

module.exports = {
    decodeBase64Url,
    normalizeGmailMessage,
    stripHtml,
}
