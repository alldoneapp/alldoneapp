import PostalMime from 'postal-mime'

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

export async function buildNormalizedPayload(message, env = {}) {
    const rawHeaders = objectFromHeaders(message.headers)
    const parsedFrom = extractMailboxAddress(rawHeaders.from || rawHeaders.From || message.from || '')
    const parsedReplyTo = extractMailboxAddress(rawHeaders['reply-to'] || rawHeaders['Reply-To'] || '')
    const parsedEmail = await parseMimeMessage(message)
    const { textBody, htmlBody } = await readBodyParts(message, parsedEmail)
    const attachments = await readAttachments(message, parsedEmail)

    return {
        messageId: String(message.headers?.get?.('message-id') || message.messageId || cryptoRandomId()).trim(),
        fromEmail: parsedFrom,
        subject: String(message.headers?.get?.('subject') || '').trim(),
        textBody,
        htmlBody,
        receivedAt: Date.now(),
        headers: rawHeaders,
        threadHeaders: {
            replyTo: parsedReplyTo,
            inReplyTo: String(message.headers?.get?.('in-reply-to') || '').trim(),
            references: String(message.headers?.get?.('references') || '').trim(),
        },
        attachments,
    }
}

async function parseMimeMessage(message) {
    try {
        const raw = await message.raw
        if (!raw) return null

        const parser = new PostalMime()
        return await parser.parse(raw)
    } catch (_) {
        return null
    }
}

async function readBodyParts(message, parsedEmail = null) {
    let textBody = ''
    let htmlBody = ''

    try {
        if (typeof parsedEmail?.text === 'string') {
            textBody = parsedEmail.text
        }
        if (typeof parsedEmail?.html === 'string') {
            htmlBody = parsedEmail.html
        }

        const raw = await message.raw
        if (!textBody && typeof raw?.text === 'function') {
            // Local tests may provide only a simple text() helper instead of a full raw MIME payload.
            textBody = await raw.text()
        }
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
