'use strict'

// Copies a public image into the project's contact photo storage and returns the public URL the
// contact document stores in `photoURL` / `photoURL50` / `photoURL300`. Storing our own copy is
// deliberate: a hot-linked Gravatar or GitHub avatar changes or disappears under the contact, and a
// company page image is often served with headers that break inside the app.
//
// The URL is model- or MCP-authored and the copy is made PUBLIC, so the download goes through the
// shared outbound URL guard (no private hosts, every redirect hop re-checked) and the bytes must
// BE an image: the type comes from the file's magic bytes, never from the URL's extension or a
// response header (NV-29). SVG is refused on purpose — it is a document that can carry script.

const admin = require('firebase-admin')
const { fetchPublicUrl, OutboundUrlError } = require('./outboundUrlGuard')

const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 15000
const USER_AGENT = 'Mozilla/5.0 (compatible; AlldoneBot/1.0; +https://alldone.app)'

/** The image type the bytes themselves declare, or null. Only raster formats we display. */
function sniffImageType(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png'
    }
    const head = buffer.subarray(0, 6).toString('latin1')
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
    if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
        return 'image/webp'
    }
    return null
}

// One message for every download failure: distinguishing "HTTP 404" from "connection refused"
// turns the tool into a reachability probe.
const DOWNLOAD_FAILED = 'The image could not be downloaded.'

const formatMegabytes = bytes => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`

async function downloadImage(
    photoUrl,
    { fetchImpl = globalThis.fetch, timeoutMs = DOWNLOAD_TIMEOUT_MS, lookup, maxBytes = MAX_PHOTO_BYTES } = {}
) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        let response
        try {
            ;({ response } = await fetchPublicUrl(
                photoUrl,
                {
                    method: 'GET',
                    headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': USER_AGENT },
                    signal: controller.signal,
                },
                { fetchImpl, ...(lookup ? { lookup } : {}) }
            ))
        } catch (error) {
            if (error instanceof OutboundUrlError && error.code === 'private_host') {
                throw new Error('Images from private or internal addresses cannot be stored.')
            }
            throw new Error(DOWNLOAD_FAILED)
        }
        if (!response.ok) throw new Error(DOWNLOAD_FAILED)
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length === 0) throw new Error('The image is empty.')
        if (buffer.length > maxBytes) throw new Error(`The image is larger than ${formatMegabytes(maxBytes)}.`)
        const contentType = sniffImageType(buffer)
        if (!contentType) {
            throw new Error('The URL does not point to a JPEG, PNG, GIF or WebP image.')
        }
        return { buffer, contentType }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Stores image bytes (already checked with sniffImageType) at `filePath` in the default bucket and
 * makes them public. Also used for assistant pictures (Assistant/assistantPhoto.js).
 * @returns {Promise<string>} the public URL
 */
async function storePublicImage({ buffer, contentType, filePath, bucket = admin.storage().bucket() }) {
    const file = bucket.file(filePath)
    await file.save(buffer, { metadata: { contentType } })
    await file.makePublic()
    return `https://storage.googleapis.com/${bucket.name}/${filePath}`
}

/**
 * @returns {Promise<string>} the public URL of the stored copy
 */
async function uploadContactPhotoFromUrl(photoUrl, projectId, contactId, options = {}) {
    if (!projectId || !contactId) throw new Error('projectId and contactId are required to store a contact photo.')
    const { buffer, contentType } = await downloadImage(photoUrl, options)
    return storePublicImage({
        buffer,
        contentType,
        filePath: `projectsContacts/${projectId}/${contactId}/${contactId}@${options.now || Date.now()}`,
        bucket: options.bucket || admin.storage().bucket(),
    })
}

module.exports = {
    MAX_PHOTO_BYTES,
    downloadImage,
    sniffImageType,
    storePublicImage,
    uploadContactPhotoFromUrl,
}
