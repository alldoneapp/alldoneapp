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
    const { textBody, htmlBody } = await readBodyParts(message)
    const attachments = await readAttachments(message)

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

async function readBodyParts(message) {
    let textBody = ''
    let htmlBody = ''

    try {
        const raw = await message.raw
        if (typeof raw?.text === 'function') {
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

async function readAttachments(message) {
    const attachments = []
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
    return String(candidate || '').trim().toLowerCase()
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
