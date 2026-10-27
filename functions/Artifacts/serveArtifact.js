'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')

const {
    getArtifactDocPath,
    getArtifactFileStoragePath,
    getArtifactVersionsCollectionPath,
    getFileNameFromPath,
    isActiveMimeType,
    isInlineMimeType,
    isTextMimeType,
    parseArtifactServePath,
    resolveRequestedFilePath,
} = require('./artifactModel')
const {
    ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY,
    ARTIFACT_BRIDGE_QUERY_PARAM,
    ARTIFACT_BRIDGE_SCRIPT,
    isBridgeScriptPath,
} = require('./artifactDataBridge')
const { appendFrameHeightScript, shouldReportFrameHeight } = require('./artifactFrameHeight')

// Serves an artifact's files at /a/{projectId}/{artifactId}/{serveSecret}/[~{versionId}/]{path}.
//
// This function must never be reachable on the app's own origin (a Hosting rewrite on
// my.alldone.app or any other alldone.app host). An HTML or SVG artifact is code written by a model
// or uploaded by somebody; on the app's origin it would run with the viewer's Firebase session,
// which lives in that origin's IndexedDB, and could do anything the viewer can. It is served from
// the function's own cloudfunctions.net origin instead, and every executable response additionally
// carries a CSP sandbox without allow-same-origin, so it runs in an opaque origin that cannot read
// any storage at all — not even another artifact's.
//
// Access is the note level (ARTIFACTS_PLAN.md §4): whoever holds the address can read the file,
// like a note attachment's download-token URL, and the secret is rotated whenever somebody loses
// read access (artifactStore.rotateServeSecretOnLostReaders) or a member presses "Reset link".

const ARTIFACT_CACHE_MS = 60 * 1000
const VERSION_CACHE_MS = 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 500

// Everything a static page legitimately needs, and nothing that lets it leave the sandbox: no
// allow-same-origin (which would hand it this origin's storage) and no allow-top-navigation (which
// would let it replace the app the iframe sits in).
const ACTIVE_CONTENT_SECURITY_POLICY =
    'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'

function createCache() {
    const entries = new Map()
    return {
        get(key, now) {
            const entry = entries.get(key)
            if (!entry) return undefined
            if (entry.expiresAt <= now) {
                entries.delete(key)
                return undefined
            }
            return entry.value
        },
        set(key, value, ttl, now) {
            if (entries.size >= MAX_CACHE_ENTRIES) entries.delete(entries.keys().next().value)
            entries.set(key, { value, expiresAt: now + ttl })
        },
        clear() {
            entries.clear()
        },
    }
}

const artifactCache = createCache()
const versionCache = createCache()

function secretsMatch(expected, provided) {
    if (typeof expected !== 'string' || typeof provided !== 'string') return false
    const left = Buffer.from(expected)
    const right = Buffer.from(provided)
    return left.length === right.length && crypto.timingSafeEqual(left, right)
}

async function loadArtifact(db, projectId, artifactId, now) {
    const key = `${projectId}/${artifactId}`
    const cached = artifactCache.get(key, now)
    if (cached !== undefined) return cached
    const snapshot = await db.doc(getArtifactDocPath(projectId, artifactId)).get()
    const artifact = snapshot.exists ? snapshot.data() || {} : null
    artifactCache.set(key, artifact, ARTIFACT_CACHE_MS, now)
    return artifact
}

// A version never changes once written, so it can be cached for long.
async function loadVersion(db, projectId, artifactId, versionId, now) {
    const key = `${projectId}/${artifactId}/${versionId}`
    const cached = versionCache.get(key, now)
    if (cached !== undefined) return cached
    const snapshot = await db.doc(`${getArtifactVersionsCollectionPath(projectId, artifactId)}/${versionId}`).get()
    const version = snapshot.exists ? snapshot.data() || {} : null
    if (version) versionCache.set(key, version, VERSION_CACHE_MS, now)
    return version
}

function contentDisposition(mimeType, fileName) {
    const type = isInlineMimeType(mimeType) ? 'inline' : 'attachment'
    const asciiName = String(fileName || 'file').replace(/[^\x20-\x7e]|["\\]/g, '_')
    return `${type}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName || 'file')}`
}

function buildArtifactResponseHeaders({
    mimeType,
    fileName,
    size,
    sha256,
    pinnedVersion,
    bridge = false,
    frameHeight = false,
}) {
    const headers = {
        'Content-Type': isTextMimeType(mimeType) ? `${mimeType}; charset=utf-8` : mimeType,
        'Content-Disposition': contentDisposition(mimeType, fileName),
        'X-Content-Type-Options': 'nosniff',
        // The secret is in the path; no-referrer keeps it from reaching the sites an artifact links to.
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
        // The address itself is the capability, so a cross-origin read reveals nothing more than the
        // address already grants. The app reads markdown and data artifacts this way to render them.
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': pinnedVersion ? 'private, max-age=31536000, immutable' : 'private, max-age=60',
    }
    if (Number.isFinite(size)) headers['Content-Length'] = String(size)
    // A framed HTML page carries the height reporter (artifactFrameHeight.js), so it is a different
    // body from the stored file: its own ETag, and a cache keyed on how the browser loaded it.
    if (sha256) headers.ETag = frameHeight ? `"${sha256}-frame"` : `"${sha256}"`
    if (mimeType === 'text/html') headers.Vary = 'Sec-Fetch-Dest'
    // A page framed for the live data bridge gets the locked-down policy (artifactDataBridge.js). It
    // follows the address, so the response that receives data is always one served with it.
    if (isActiveMimeType(mimeType)) {
        headers['Content-Security-Policy'] = bridge
            ? ARTIFACT_BRIDGE_CONTENT_SECURITY_POLICY
            : ACTIVE_CONTENT_SECURITY_POLICY
    }
    return headers
}

function sendPlain(res, status, message) {
    res.status(status)
    res.set({
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
    })
    res.send(message)
}

function getQueryValue(req, name) {
    const value = req.query?.[name]
    return Array.isArray(value) ? value[0] : value
}

function sendBridgeScript(req, res) {
    res.status(200)
    res.set({
        'Content-Type': 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'private, max-age=3600',
    })
    if (req.method === 'HEAD') return res.end()
    return res.send(ARTIFACT_BRIDGE_SCRIPT)
}

async function handleServeArtifactRequest(
    req,
    res,
    { db = admin.firestore(), bucket = admin.storage().bucket(), now = Date.now() } = {}
) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.set('Allow', 'GET, HEAD')
        return sendPlain(res, 405, 'Method not allowed')
    }

    const parsed = parseArtifactServePath(req.path || req.url || '')
    if (!parsed) return sendPlain(res, 404, 'Not found')

    try {
        const artifact = await loadArtifact(db, parsed.projectId, parsed.artifactId, now)
        // A missing artifact and a wrong secret look the same from outside.
        if (!artifact || !secretsMatch(artifact.serveSecret, parsed.serveSecret)) {
            return sendPlain(res, 404, 'Not found')
        }

        // The bridge script belongs to no artifact; it is offered under every artifact's address so a
        // page can load it with a relative path.
        if (isBridgeScriptPath(parsed.path)) return sendBridgeScript(req, res)

        const versionId = parsed.versionId || artifact.currentVersionId
        if (!versionId) return sendPlain(res, 404, 'Not found')
        const version = await loadVersion(db, parsed.projectId, parsed.artifactId, versionId, now)
        if (!version) return sendPlain(res, 404, 'Not found')

        const filePath = resolveRequestedFilePath(parsed.path, version.entryPath)
        const files = Array.isArray(version.files) ? version.files : []
        const file = filePath ? files.find(candidate => candidate.path === filePath) : null
        if (!file) return sendPlain(res, 404, 'Not found')

        // AT-2881: a page shown inside the app reports its height, so the app can frame it at its
        // natural height instead of giving it a scrollbar of its own.
        const frameHeight = shouldReportFrameHeight(req, file.mimeType)
        const headers = buildArtifactResponseHeaders({
            mimeType: file.mimeType,
            fileName: getFileNameFromPath(file.path),
            size: Number(file.size),
            sha256: file.sha256,
            pinnedVersion: !!parsed.versionId,
            bridge: getQueryValue(req, ARTIFACT_BRIDGE_QUERY_PARAM) === '1',
            frameHeight,
        })

        const ifNoneMatch = req.get ? req.get('if-none-match') : req.headers?.['if-none-match']
        if (headers.ETag && ifNoneMatch === headers.ETag) {
            delete headers['Content-Length']
            res.status(304)
            res.set(headers)
            return res.end()
        }

        const storagePath = getArtifactFileStoragePath(parsed.projectId, parsed.artifactId, versionId, file.path)
        if (frameHeight) {
            // The stored size no longer describes the body; HEAD answers without it rather than
            // reading the file only to count it.
            delete headers['Content-Length']
            if (req.method === 'HEAD') {
                res.status(200)
                res.set(headers)
                return res.end()
            }
            const [stored] = await bucket.file(storagePath).download()
            const body = appendFrameHeightScript(stored)
            headers['Content-Length'] = String(body.length)
            res.status(200)
            res.set(headers)
            return res.end(body)
        }

        res.status(200)
        res.set(headers)
        if (req.method === 'HEAD') return res.end()

        const stream = bucket.file(storagePath).createReadStream()
        return await new Promise(resolve => {
            stream.on('error', error => {
                console.error('[artifacts] Could not stream an artifact file', {
                    projectId: parsed.projectId,
                    artifactId: parsed.artifactId,
                    versionId,
                    path: file.path,
                    error: error.message,
                })
                if (!res.headersSent) sendPlain(res, 500, 'Could not read the file')
                else res.destroy(error)
                resolve()
            })
            stream.on('end', resolve)
            stream.pipe(res)
        })
    } catch (error) {
        console.error('[artifacts] Could not serve an artifact', {
            projectId: parsed.projectId,
            artifactId: parsed.artifactId,
            error: error.message,
        })
        if (!res.headersSent) return sendPlain(res, 500, 'Could not serve the artifact')
        return res.destroy(error)
    }
}

function clearServeArtifactCaches() {
    artifactCache.clear()
    versionCache.clear()
}

module.exports = {
    ACTIVE_CONTENT_SECURITY_POLICY,
    buildArtifactResponseHeaders,
    clearServeArtifactCaches,
    handleServeArtifactRequest,
    secretsMatch,
}
