'use strict'

// Copies a public image into the project's contact photo storage and returns the public URL the
// contact document stores in `photoURL` / `photoURL50` / `photoURL300`. Storing our own copy is
// deliberate: a hot-linked Gravatar or GitHub avatar changes or disappears under the contact, and a
// company page image is often served with headers that break inside the app.

const admin = require('firebase-admin')

const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 15000
const USER_AGENT = 'Mozilla/5.0 (compatible; AlldoneBot/1.0; +https://alldone.app)'

function inferContentType(headerValue, url) {
    const header = String(headerValue || '')
        .split(';')[0]
        .trim()
        .toLowerCase()
    if (header.startsWith('image/')) return header
    const extension = (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(url || '') || [])[1]
    const byExtension = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
    }
    return byExtension[String(extension || '').toLowerCase()] || null
}

async function downloadImage(photoUrl, { fetchImpl = globalThis.fetch, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetchImpl(photoUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': USER_AGENT },
            signal: controller.signal,
        })
        if (!response.ok) {
            throw new Error(`The image could not be downloaded (HTTP ${response.status}).`)
        }
        const contentType = inferContentType(
            response.headers?.get ? response.headers.get('content-type') : '',
            photoUrl
        )
        if (!contentType) {
            throw new Error('The URL does not point to an image.')
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length === 0) throw new Error('The image is empty.')
        if (buffer.length > MAX_PHOTO_BYTES) throw new Error('The image is larger than 10 MB.')
        return { buffer, contentType }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * @returns {Promise<string>} the public URL of the stored copy
 */
async function uploadContactPhotoFromUrl(photoUrl, projectId, contactId, options = {}) {
    if (!projectId || !contactId) throw new Error('projectId and contactId are required to store a contact photo.')
    const { buffer, contentType } = await downloadImage(photoUrl, options)

    const bucket = options.bucket || admin.storage().bucket()
    const filePath = `projectsContacts/${projectId}/${contactId}/${contactId}@${options.now || Date.now()}`
    const file = bucket.file(filePath)
    await file.save(buffer, { metadata: { contentType } })
    await file.makePublic()
    return `https://storage.googleapis.com/${bucket.name}/${filePath}`
}

module.exports = {
    MAX_PHOTO_BYTES,
    downloadImage,
    inferContentType,
    uploadContactPhotoFromUrl,
}
