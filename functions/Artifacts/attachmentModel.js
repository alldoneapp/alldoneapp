'use strict'

// Attachment identity is the stored object, not its download token or its display name.
// Keep this module free of Firebase dependencies so indexing and the client can share it.
const ATTACHMENT_PREFIXES = ['attachments/', 'feedAttachments/', 'notesAttachments/']
const STORAGE_HOST = 'firebasestorage.googleapis.com'

function parseAttachmentUrl(url, bucketName) {
    let parsed
    try {
        parsed = new URL(String(url || ''))
    } catch (_) {
        return null
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== STORAGE_HOST) return null
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/)
    if (!match || match[1] !== bucketName) return null
    let path
    try {
        path = decodeURIComponent(match[2])
    } catch (_) {
        return null
    }
    const token = parsed.searchParams.get('token')
    if (!token || !ATTACHMENT_PREFIXES.some(prefix => path.startsWith(prefix))) return null
    if (path.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null
    return { path, token }
}

const TOKEN_FORMATS = [
    { trigger: 'EbDsQTD14ahtSR5', nameIndex: 2, fields: 3 },
    { trigger: 'O2TI5plHBf1QfdY', nameIndex: 3, fields: 4 },
    { trigger: 'ptPQsef7OeB5eWd', nameIndex: 2, fields: 3 },
]

// Reads saved comment/description tokens and Quill note deltas. Thumbnails are deliberately
// ignored: a screenshot contributes its original file once, even if embedded more than once.
function extractAttachmentReferences(content, bucketName) {
    const references = new Map()
    const add = (url, fileName) => {
        const attachment = parseAttachmentUrl(url, bucketName)
        if (!attachment || references.has(attachment.path)) return
        references.set(attachment.path, { path: attachment.path, url, fileName: String(fileName || '') })
    }
    const readText = text => {
        for (const { trigger, nameIndex, fields } of TOKEN_FORMATS) {
            const pattern = new RegExp(`${trigger}(?:[^\\r\\n]*?${trigger}){${fields - 1}}[^\\s]*`, 'g')
            for (const match of text.matchAll(pattern)) {
                const parts = match[0].split(trigger)
                add(parts[1], parts[nameIndex])
            }
        }
    }
    if (typeof content === 'string') readText(content)
    else {
        const ops = Array.isArray(content) ? content : Array.isArray(content?.ops) ? content.ops : []
        for (const { insert } of ops) {
            if (typeof insert === 'string') readText(insert)
            else if (insert && typeof insert === 'object') {
                for (const format of ['attachment', 'customImageFormat', 'videoFormat']) {
                    const value = insert[format]
                    if (value) add(value.uri, value.text)
                }
            }
        }
    }
    return Array.from(references.values())
}

module.exports = { ATTACHMENT_PREFIXES, parseAttachmentUrl, extractAttachmentReferences }
