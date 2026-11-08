import PostalMime from 'postal-mime'

import { buildSenderAuthentication } from './senderAuthentication.mjs'

export default {
    async email(message, env, ctx) {
        const payload = await buildNormalizedPayload(message, env)

        const response = await fetch(env.FIREBASE_EMAIL_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${env.ANNA_EMAIL_WEBHOOK_BEARER_TOKEN}`,
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            const text = await response.text()
            console.error('Anna email worker: Firebase webhook failed', {
                status: response.status,
                body: text,
                messageId: payload.messageId,
            })
        }
    },
}

export function parseDateHeader(value) {
    const normalized = String(value || '').trim()
    if (!normalized) return null

    const parsed = Date.parse(normalized)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export async function buildNormalizedPayload(message, env = {}, options = {}) {
    const rawHeaders = objectFromHeaders(message.headers)
    // Use only the SMTP envelope sender for authorization. Header From can be spoofed independently.
    const parsedFrom = extractMailboxAddress(message.from || '')
    const parsedReplyTo = extractMailboxAddress(rawHeaders['reply-to'] || rawHeaders['Reply-To'] || '')
    // The SMTP envelope includes BCC delivery targets; it must never masquerade as
    // a visible To header, or Anna could expose a blind copy by replying to everyone.
    const toEmails = extractMailboxAddresses(rawHeaders.to || rawHeaders.To || '')
    const ccEmails = extractMailboxAddresses(rawHeaders.cc || rawHeaders.Cc || '')
    // `message.raw` is a stream that can be read once, so it is buffered here and shared by the
    // MIME parser and the DKIM check.
    const rawMessage = await readRawMessage(message)
    const parsedEmail = await parseMimeMessage(rawMessage.bytes)
    const { textBody, htmlBody } = await readBodyParts(message, parsedEmail, rawMessage.legacyText)
    const attachments = await readAttachments(message, parsedEmail)
    // NV-06: the envelope sender is only a claim. Cloud Functions route the message to an account
    // only when a DKIM signature aligned with that sender's domain verified here.
    const senderAuthentication = await buildSenderAuthentication({
        rawBytes: rawMessage.bytes,
        headers: message.headers,
        env,
        resolveTxt: options.resolveTxt,
        now: options.now,
    })

    return {
        messageId: String(message.headers?.get?.('message-id') || message.messageId || cryptoRandomId()).trim(),
        fromEmail: parsedFrom,
        toEmails,
        ccEmails,
        subject: String(message.headers?.get?.('subject') || '').trim(),
        textBody,
        htmlBody,
        receivedAt: Date.now(),
        // When the sender actually sent the mail, as opposed to when we received it. Kept as
        // an explicit field so downstream consumers do not have to dig through rawHeaders.
        sentAt: parseDateHeader(rawHeaders.date || rawHeaders.Date || ''),
        headers: rawHeaders,
        threadHeaders: {
            replyTo: parsedReplyTo,
            inReplyTo: String(message.headers?.get?.('in-reply-to') || '').trim(),
            references: String(message.headers?.get?.('references') || '').trim(),
        },
        attachments,
        senderAuthentication,
    }
}

async function readRawMessage(message) {
    try {
        const raw = await message.raw
        if (!raw) return { bytes: null, legacyText: '' }
        if (raw instanceof Uint8Array) return { bytes: raw, legacyText: '' }
        if (raw instanceof ArrayBuffer) return { bytes: new Uint8Array(raw), legacyText: '' }
        if (typeof raw === 'string') return { bytes: new TextEncoder().encode(raw), legacyText: '' }
        if (typeof raw.getReader === 'function') {
            return { bytes: new Uint8Array(await new Response(raw).arrayBuffer()), legacyText: '' }
        }
        // Local tests may provide only a simple text() helper instead of a full raw MIME payload.
        if (typeof raw.text === 'function') return { bytes: null, legacyText: String((await raw.text()) || '') }
    } catch (_) {}
    return { bytes: null, legacyText: '' }
}

async function parseMimeMessage(rawBytes) {
    try {
        if (!rawBytes) return null

        const parser = new PostalMime()
        return await parser.parse(rawBytes)
    } catch (_) {
        return null
    }
}

async function readBodyParts(message, parsedEmail = null, legacyText = '') {
    let textBody = ''
    let htmlBody = ''

    try {
        if (typeof parsedEmail?.text === 'string') {
            textBody = parsedEmail.text
        }
        if (typeof parsedEmail?.html === 'string') {
            htmlBody = parsedEmail.html
        }

        if (!textBody && legacyText) textBody = legacyText
    } catch (_) {}

    if (message.text) {
        textBody = typeof message.text === 'string' ? message.text : textBody
    }

    if (message.html) {
        htmlBody = typeof message.html === 'string' ? message.html : htmlBody
    }

    return {
        textBody: String(textBody || '').trim(),
        htmlBody: String(htmlBody || '').trim(),
    }
}

async function readAttachments(message, parsedEmail = null) {
    const attachments = []

    const parsedAttachments = Array.isArray(parsedEmail?.attachments) ? parsedEmail.attachments : []
    for (const attachment of parsedAttachments) {
        const fileName = String(attachment.filename || attachment.name || 'attachment').trim()
        const contentType = String(attachment.mimeType || attachment.contentType || 'application/octet-stream').trim()
        const content = attachment.content
        const bytes =
            content instanceof Uint8Array
                ? content
                : content instanceof ArrayBuffer
                  ? new Uint8Array(content)
                  : typeof Buffer !== 'undefined' && Buffer.isBuffer(content)
                    ? new Uint8Array(content)
                    : new Uint8Array()

        attachments.push({
            fileName,
            contentType,
            contentBase64: uint8ToBase64(bytes),
            sizeBytes: Number(bytes.byteLength || attachment.size || 0) || 0,
        })
    }

    if (attachments.length > 0) return attachments

    const iterable = Array.isArray(message.attachments) ? message.attachments : []

    for (const attachment of iterable) {
        const fileName = String(attachment.filename || attachment.name || 'attachment').trim()
        const contentType = String(attachment.contentType || attachment.type || 'application/octet-stream').trim()
        const arrayBuffer = typeof attachment.arrayBuffer === 'function' ? await attachment.arrayBuffer() : null
        const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : new Uint8Array()

        attachments.push({
            fileName,
            contentType,
            contentBase64: uint8ToBase64(bytes),
            sizeBytes: Number(bytes.byteLength || attachment.size || 0) || 0,
        })
    }

    return attachments
}

function objectFromHeaders(headers) {
    const result = {}
    if (!headers || typeof headers.entries !== 'function') return result

    for (const [key, value] of headers.entries()) {
        result[key] = value
    }
    return result
}

function extractMailboxAddress(value = '') {
    const normalized = String(value || '').trim()
    const match = normalized.match(/<([^>]+)>/)
    const candidate = match?.[1] || normalized
    return String(candidate || '')
        .trim()
        .toLowerCase()
}

function extractMailboxAddresses(value = '') {
    const input = String(value || '').trim()
    if (!input) return []

    const entries = []
    let current = ''
    let insideQuotes = false
    let angleDepth = 0

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index]
        if (char === '"' && input[index - 1] !== '\\') insideQuotes = !insideQuotes
        if (!insideQuotes && char === '<') angleDepth += 1
        if (!insideQuotes && char === '>' && angleDepth > 0) angleDepth -= 1

        if (!insideQuotes && angleDepth === 0 && char === ',') {
            entries.push(current)
            current = ''
            continue
        }
        current += char
    }
    entries.push(current)

    return Array.from(new Set(entries.map(extractMailboxAddress).filter(email => email.includes('@'))))
}

function uint8ToBase64(bytes) {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64')
    }

    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return binary ? btoa(binary) : ''
}

function cryptoRandomId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    return `anna-${Date.now()}`
}
