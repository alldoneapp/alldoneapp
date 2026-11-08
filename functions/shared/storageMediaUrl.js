'use strict'

// Security audit 2026-11 (#20): the assistant fetches chat media on the server (text extraction,
// get_chat_attachment, reading an uploaded deck into the wiki). The URL comes from the comment —
// `mediaContext`, `processedMedia` or an attachment token in the text — and a comment is member
// written, so the URL is attacker-chosen: without a check the Functions runtime fetched any address
// (including the metadata server and other internal hosts) and followed redirects wherever they led.
//
// A chat attachment always lives in this project's own Firebase Storage bucket, so that is all
// that is fetched, and redirects are refused rather than followed.

const STORAGE_API_HOST = 'firebasestorage.googleapis.com'
const GCS_HOST = 'storage.googleapis.com'

function resolveRuntimeProjectId() {
    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
    if (!projectId && process.env.FIREBASE_CONFIG) {
        try {
            projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId
        } catch (_) {}
    }
    return projectId || ''
}

function resolveConfiguredBucket() {
    try {
        if (process.env.FIREBASE_CONFIG) {
            const bucket = JSON.parse(process.env.FIREBASE_CONFIG).storageBucket
            if (bucket) return bucket
        }
    } catch (_) {}
    try {
        const admin = require('firebase-admin')
        return admin.app().options?.storageBucket || ''
    } catch (_) {
        return ''
    }
}

function getAllowedMediaBuckets({
    projectId = resolveRuntimeProjectId(),
    configuredBucket = resolveConfiguredBucket(),
} = {}) {
    const buckets = new Set()
    if (configuredBucket) buckets.add(String(configuredBucket).toLowerCase())
    if (projectId) {
        buckets.add(`${projectId}.appspot.com`.toLowerCase())
        buckets.add(`${projectId}.firebasestorage.app`.toLowerCase())
    }
    return buckets
}

function getStorageMediaBucket(url) {
    let parsed
    try {
        parsed = new URL(String(url || ''))
    } catch (_) {
        return null
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null
    const host = parsed.hostname.toLowerCase()
    if (host === STORAGE_API_HOST) {
        const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/[^/]+$/)
        return match ? decodeURIComponent(match[1]).toLowerCase() : null
    }
    if (host === GCS_HOST) {
        const match = parsed.pathname.match(/^\/([^/]+)\/.+/)
        return match ? decodeURIComponent(match[1]).toLowerCase() : null
    }
    return null
}

function isAllowedStorageMediaUrl(url, buckets = getAllowedMediaBuckets()) {
    const bucket = getStorageMediaBucket(url)
    return !!bucket && buckets.has(bucket)
}

function assertAllowedStorageMediaUrl(url, buckets) {
    if (!isAllowedStorageMediaUrl(url, buckets)) {
        throw new Error('This attachment is not stored in Alldone and cannot be read')
    }
}

// fetch() for a chat attachment: this project's bucket only, never a redirect.
async function fetchStorageMedia(url, { fetchImpl = fetch, buckets, timeoutMs = 30000 } = {}) {
    assertAllowedStorageMediaUrl(url, buckets)
    return fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
}

module.exports = {
    assertAllowedStorageMediaUrl,
    fetchStorageMedia,
    getAllowedMediaBuckets,
    getStorageMediaBucket,
    isAllowedStorageMediaUrl,
}
