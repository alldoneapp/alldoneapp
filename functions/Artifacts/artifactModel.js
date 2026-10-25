'use strict'

// Project artifacts: what a project produced — an HTML dashboard, a report, a PDF, an image —
// uploaded by a member or, later, created by an assistant or a VM run (ARTIFACTS_PLAN.md).
//
//   artifactItems/{projectId}/artifacts/{artifactId}                       metadata, read like a note
//   artifactItems/{projectId}/artifacts/{artifactId}/versions/{versionId}  immutable version manifests
//   Storage: artifacts/{projectId}/{artifactId}/{versionId}/{path}         bytes, read only by serveArtifact
//
// An artifact is never edited in place: it changes by getting a new version, which is what makes a
// version safe to cache forever. Its bytes are served by the serveArtifact function from an origin
// that is not the app's, at an address whose `serveSecret` segment the server rotates whenever
// somebody loses read access. See serveArtifact.js for why the origin matters.
//
// Pure module: the web app imports it too, so it must not require anything server-only.

const ARTIFACT_ITEMS_COLLECTION = 'artifactItems'
const ARTIFACTS_SUBCOLLECTION = 'artifacts'
const ARTIFACT_VERSIONS_SUBCOLLECTION = 'versions'
const ARTIFACT_STORAGE_PREFIX = 'artifacts'
const SERVE_ARTIFACT_FUNCTION = 'serveArtifact'

const FEED_PUBLIC_FOR_ALL = 0

// A version's files travel as one callable request (base64 inside JSON), and Cloud Functions
// accepts at most 32 MiB per request: 20 MiB of bytes is ~27 MiB once encoded.
const MAX_ARTIFACT_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_ARTIFACT_FILES = 200
const MAX_ARTIFACT_PATH_CHARS = 512
const MAX_ARTIFACT_SEGMENT_CHARS = 255
const MAX_ARTIFACT_TITLE_CHARS = 200
const MAX_ARTIFACT_DESCRIPTION_CHARS = 2000
const MAX_ARTIFACT_CHANGE_SUMMARY_CHARS = 500

// Written only by Cloud Functions. firestore.rules refuses any client update that touches one,
// and the server never trusts a client-supplied value for them.
const ARTIFACT_SERVER_FIELDS = [
    'serveSecret',
    'serveSecretRotatedAt',
    'currentVersionId',
    'versionCount',
    'kind',
    'mimeType',
    'entryPath',
    'sizeBytes',
    'fileCount',
    'source',
    'creatorId',
    'created',
    'creatorAssistantId',
    'vmOutputKey',
    // Where the artifact was made (the thread of a task, goal, note…). It is what lists the
    // artifact as that object's result, so only the server sets it.
    'parentObject',
    // Whether the app answers the page's live data questions (artifactDataBridge.js). Only the
    // owner switches it, through the server.
    'dataAccess',
]

const ARTIFACT_KINDS = {
    WEB: 'web',
    MARKDOWN: 'markdown',
    PDF: 'pdf',
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    DATA: 'data',
    TEXT: 'text',
    FILE: 'file',
}

const ARTIFACT_SOURCES = {
    UPLOAD: 'upload',
    ASSISTANT: 'assistant',
    VM: 'vm',
}

// The type is always derived from the file name, never taken from the client: it decides whether a
// response is executable (and therefore sandboxed), so a forged `text/plain` on an HTML file must
// not be able to switch the sandbox off.
const MIME_TYPES_BY_EXTENSION = {
    html: 'text/html',
    htm: 'text/html',
    xhtml: 'application/xhtml+xml',
    svg: 'image/svg+xml',
    xml: 'application/xml',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    map: 'application/json',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    log: 'text/plain',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    m4a: 'audio/mp4',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    wasm: 'application/wasm',
    zip: 'application/zip',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const DEFAULT_MIME_TYPE = 'application/octet-stream'

// Documents a browser can run script in. These are only ever served with a CSP sandbox.
const ACTIVE_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/xml'])

const INLINE_MIME_PREFIXES = ['text/', 'image/', 'video/', 'audio/', 'font/']
const INLINE_MIME_TYPES = new Set([
    'application/pdf',
    'application/json',
    'application/xml',
    'application/xhtml+xml',
    'application/wasm',
])

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const SECRET_PATTERN = /^[A-Za-z0-9_-]{20,128}$/

function getArtifactsCollectionPath(projectId) {
    return `${ARTIFACT_ITEMS_COLLECTION}/${projectId}/${ARTIFACTS_SUBCOLLECTION}`
}

function getArtifactDocPath(projectId, artifactId) {
    return `${getArtifactsCollectionPath(projectId)}/${artifactId}`
}

function getArtifactVersionsCollectionPath(projectId, artifactId) {
    return `${getArtifactDocPath(projectId, artifactId)}/${ARTIFACT_VERSIONS_SUBCOLLECTION}`
}

function getArtifactStoragePrefix(projectId, artifactId) {
    return `${ARTIFACT_STORAGE_PREFIX}/${projectId}/${artifactId}/`
}

function getArtifactFileStoragePath(projectId, artifactId, versionId, path) {
    return `${getArtifactStoragePrefix(projectId, artifactId)}${versionId}/${path}`
}

function getFileExtension(path) {
    const name = String(path || '')
        .split('/')
        .pop()
    const dot = name.lastIndexOf('.')
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function getMimeTypeForPath(path) {
    return MIME_TYPES_BY_EXTENSION[getFileExtension(path)] || DEFAULT_MIME_TYPE
}

function isActiveMimeType(mimeType) {
    return ACTIVE_MIME_TYPES.has(mimeType)
}

function isInlineMimeType(mimeType) {
    if (INLINE_MIME_TYPES.has(mimeType)) return true
    return INLINE_MIME_PREFIXES.some(prefix => String(mimeType).startsWith(prefix))
}

function isTextMimeType(mimeType) {
    return (
        String(mimeType).startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType === 'application/xml' ||
        mimeType === 'application/xhtml+xml' ||
        mimeType === 'image/svg+xml'
    )
}

function getArtifactKindForMimeType(mimeType) {
    if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') return ARTIFACT_KINDS.WEB
    if (mimeType === 'text/markdown') return ARTIFACT_KINDS.MARKDOWN
    if (mimeType === 'application/pdf') return ARTIFACT_KINDS.PDF
    if (String(mimeType).startsWith('image/')) return ARTIFACT_KINDS.IMAGE
    if (String(mimeType).startsWith('video/')) return ARTIFACT_KINDS.VIDEO
    if (String(mimeType).startsWith('audio/')) return ARTIFACT_KINDS.AUDIO
    if (
        mimeType === 'text/csv' ||
        mimeType === 'text/tab-separated-values' ||
        mimeType === 'application/json' ||
        mimeType === MIME_TYPES_BY_EXTENSION.xlsx
    ) {
        return ARTIFACT_KINDS.DATA
    }
    if (String(mimeType).startsWith('text/')) return ARTIFACT_KINDS.TEXT
    return ARTIFACT_KINDS.FILE
}

class ArtifactInputError extends Error {}

// A path inside an artifact, as stored in its manifest and addressed in its URL: relative, `/`
// separated, no empty, `.` or `..` segments and no control characters. Anything else is refused
// rather than repaired, so the stored path is exactly what a relative link inside the artifact
// will ask for.
function normalizeArtifactPath(path) {
    if (typeof path !== 'string') throw new ArtifactInputError('A file path is required.')
    const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalized) throw new ArtifactInputError('A file path is required.')
    if (normalized.length > MAX_ARTIFACT_PATH_CHARS) throw new ArtifactInputError('A file path is too long.')
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new ArtifactInputError('A file path is not valid.')
    const segments = normalized.split('/')
    segments.forEach(segment => {
        if (!segment || segment === '.' || segment === '..') {
            throw new ArtifactInputError('A file path is not valid.')
        }
        if (segment.length > MAX_ARTIFACT_SEGMENT_CHARS) throw new ArtifactInputError('A file name is too long.')
    })
    return segments.join('/')
}

function getFileNameFromPath(path) {
    return String(path || '')
        .split('/')
        .pop()
}

function getTitleFromFileName(fileName) {
    const name = String(fileName || '').trim()
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    return base.replace(/[_]+/g, ' ').trim() || name
}

function normalizeArtifactTitle(title) {
    if (title === undefined || title === null) return ''
    if (typeof title !== 'string') throw new ArtifactInputError('The title must be text.')
    return title.trim().slice(0, MAX_ARTIFACT_TITLE_CHARS)
}

function normalizeArtifactDescription(description) {
    if (description === undefined || description === null) return ''
    if (typeof description !== 'string') throw new ArtifactInputError('The description must be text.')
    return description.trim().slice(0, MAX_ARTIFACT_DESCRIPTION_CHARS)
}

function normalizeChangeSummary(changeSummary) {
    if (changeSummary === undefined || changeSummary === null) return ''
    if (typeof changeSummary !== 'string') throw new ArtifactInputError('The change summary must be text.')
    return changeSummary.trim().slice(0, MAX_ARTIFACT_CHANGE_SUMMARY_CHARS)
}

// The file a viewer lands on: the only file, otherwise a root index.html, otherwise the first HTML
// file, otherwise the first file. Paths are compared as stored (already normalized).
function resolveEntryPath(paths) {
    if (!Array.isArray(paths) || paths.length === 0) return null
    if (paths.length === 1) return paths[0]
    if (paths.includes('index.html')) return 'index.html'
    if (paths.includes('index.htm')) return 'index.htm'
    const firstHtml = paths.find(path => getMimeTypeForPath(path) === 'text/html')
    return firstHtml || paths[0]
}

function isProjectPublic(isPublicFor) {
    return Array.isArray(isPublicFor) && isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
}

// Private means visible to the owner only, the same convention notes follow.
function buildArtifactIsPublicFor(isPrivate, ownerId) {
    return isPrivate ? [ownerId] : [FEED_PUBLIC_FOR_ALL, ownerId]
}

// Reader ids that were in `before` and are gone in `after`. Any such loss rotates the artifact's
// serve secret: a link copied while somebody could still read the artifact must stop working.
function getLostReaderIds(before = {}, after = {}) {
    const beforeReaders = Array.isArray(before.readerIds) ? before.readerIds : []
    if (beforeReaders.length === 0) return []
    const afterReaders = new Set(Array.isArray(after.readerIds) ? after.readerIds.map(String) : [])
    return beforeReaders.filter(readerId => !afterReaders.has(String(readerId)))
}

function encodeArtifactPath(path) {
    return String(path || '')
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/')
}

// `/a/{projectId}/{artifactId}/{serveSecret}/` serves the current version and `.../~{versionId}/`
// one fixed version. The secret is a path segment, not a query parameter, so relative links inside
// a multi-file artifact (`./app.js`) resolve under it without a cookie.
function buildArtifactServePath({ projectId, artifactId, serveSecret, versionId = null, path = '' }) {
    if (!projectId || !artifactId || !serveSecret) return null
    const versionSegment = versionId ? `~${versionId}/` : ''
    return `/a/${projectId}/${artifactId}/${serveSecret}/${versionSegment}${encodeArtifactPath(path)}`
}

function buildArtifactServeUrl(baseUrl, params) {
    const path = buildArtifactServePath(params)
    if (!baseUrl || !path) return null
    return `${String(baseUrl).replace(/\/+$/, '')}${path}`
}

// Accepts the path with or without the function name in front of it: Cloud Functions' own URL
// (`/serveArtifact/a/...`) and a Hosting rewrite (`/a/...`) both end up here.
function parseArtifactServePath(pathname) {
    if (typeof pathname !== 'string') return null
    let rest = pathname
    const functionPrefix = `/${SERVE_ARTIFACT_FUNCTION}`
    if (rest === functionPrefix || rest.startsWith(`${functionPrefix}/`)) rest = rest.slice(functionPrefix.length)
    if (!rest.startsWith('/a/')) return null

    const parts = rest.slice(3).split('/')
    if (parts.length < 4) return null
    const [projectId, artifactId, serveSecret, ...pathParts] = parts
    if (!ID_PATTERN.test(projectId) || !ID_PATTERN.test(artifactId) || !SECRET_PATTERN.test(serveSecret)) return null

    let versionId = null
    if (pathParts.length > 0 && pathParts[0].startsWith('~')) {
        versionId = pathParts.shift().slice(1)
        if (!ID_PATTERN.test(versionId)) return null
    }

    let path
    try {
        path = pathParts.map(segment => decodeURIComponent(segment)).join('/')
    } catch (_) {
        return null
    }
    return { projectId, artifactId, serveSecret, versionId, path }
}

// '' is the artifact's entry file and a path ending in '/' a directory's index.html.
function resolveRequestedFilePath(requestedPath, entryPath) {
    if (!requestedPath) return entryPath || null
    const withIndex = requestedPath.endsWith('/') ? `${requestedPath}index.html` : requestedPath
    try {
        return normalizeArtifactPath(withIndex)
    } catch (_) {
        return null
    }
}

function mapArtifactData(artifactId, data = {}) {
    const isPublicFor = Array.isArray(data.isPublicFor) ? data.isPublicFor : [FEED_PUBLIC_FOR_ALL, data.userId]
    return {
        id: data.id || artifactId,
        title: data.title || '',
        description: data.description || '',
        kind: data.kind || ARTIFACT_KINDS.FILE,
        source: data.source || ARTIFACT_SOURCES.UPLOAD,
        mimeType: data.mimeType || DEFAULT_MIME_TYPE,
        entryPath: data.entryPath || '',
        sizeBytes: Number(data.sizeBytes) || 0,
        fileCount: Number(data.fileCount) || 0,
        currentVersionId: data.currentVersionId || null,
        versionCount: Number(data.versionCount) || 0,
        serveSecret: data.serveSecret || null,
        created: Number(data.created) || 0,
        creatorId: data.creatorId || '',
        userId: data.userId || '',
        lastEditorId: data.lastEditorId || '',
        lastEditionDate: Number(data.lastEditionDate) || Number(data.created) || 0,
        isPrivate: data.isPrivate === true,
        isPublicFor,
        hasStar: data.hasStar || '#FFFFFF',
        followersIds: Array.isArray(data.followersIds) ? data.followersIds : [],
        isVisibleInFollowedFor: Array.isArray(data.isVisibleInFollowedFor) ? data.isVisibleInFollowedFor : [],
        parentObject: data.parentObject || null,
        // The assistant that created the artifact (server-owned), and the assistant that answers in
        // its chat (client-editable, like on every other object). They start out the same.
        creatorAssistantId: data.creatorAssistantId || null,
        assistantId: data.assistantId || '',
        isAssistantEnabled: data.isAssistantEnabled === true,
        // The chat's last comment, as on every other object with a chat.
        commentsData: data.commentsData || null,
        dataAccess: data.dataAccess === true,
    }
}

function mapArtifactVersionData(versionId, data = {}) {
    return {
        id: data.id || versionId,
        versionNumber: Number(data.versionNumber) || 0,
        files: Array.isArray(data.files) ? data.files : [],
        entryPath: data.entryPath || '',
        sizeBytes: Number(data.sizeBytes) || 0,
        createdBy: data.createdBy || '',
        createdAt: Number(data.createdAt) || 0,
        changeSummary: data.changeSummary || '',
        source: data.source || ARTIFACT_SOURCES.UPLOAD,
        assistantId: data.assistantId || null,
    }
}

// The artifact opened in the app, behind the viewer's own sign-in. This is the link an assistant
// hands out: the serve URL carries the secret, and a chat can be readable by more people than the
// artifact is.
function buildArtifactAppPath(projectId, artifactId) {
    return `/projects/${projectId}/artifacts/${artifactId}`
}

function sortArtifactsByLastEdition(artifacts) {
    return [...artifacts].sort((left, right) => {
        const diff = (Number(right.lastEditionDate) || 0) - (Number(left.lastEditionDate) || 0)
        return diff !== 0 ? diff : String(left.id).localeCompare(String(right.id))
    })
}

module.exports = {
    ACTIVE_MIME_TYPES,
    ARTIFACT_ITEMS_COLLECTION,
    ARTIFACT_KINDS,
    ARTIFACT_SERVER_FIELDS,
    ARTIFACT_SOURCES,
    ARTIFACT_STORAGE_PREFIX,
    ARTIFACT_VERSIONS_SUBCOLLECTION,
    ARTIFACTS_SUBCOLLECTION,
    ArtifactInputError,
    DEFAULT_MIME_TYPE,
    FEED_PUBLIC_FOR_ALL,
    MAX_ARTIFACT_DESCRIPTION_CHARS,
    MAX_ARTIFACT_FILES,
    MAX_ARTIFACT_TITLE_CHARS,
    MAX_ARTIFACT_UPLOAD_BYTES,
    SERVE_ARTIFACT_FUNCTION,
    buildArtifactAppPath,
    buildArtifactIsPublicFor,
    buildArtifactServePath,
    buildArtifactServeUrl,
    encodeArtifactPath,
    getArtifactDocPath,
    getArtifactFileStoragePath,
    getArtifactKindForMimeType,
    getArtifactStoragePrefix,
    getArtifactVersionsCollectionPath,
    getArtifactsCollectionPath,
    getFileExtension,
    getFileNameFromPath,
    getLostReaderIds,
    getMimeTypeForPath,
    getTitleFromFileName,
    isActiveMimeType,
    isInlineMimeType,
    isProjectPublic,
    isTextMimeType,
    mapArtifactData,
    mapArtifactVersionData,
    normalizeArtifactDescription,
    normalizeArtifactPath,
    normalizeArtifactTitle,
    normalizeChangeSummary,
    parseArtifactServePath,
    resolveEntryPath,
    resolveRequestedFilePath,
    sortArtifactsByLastEdition,
}
