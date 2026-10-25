'use strict'

const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

const { commitArtifactVersion } = require('./artifactStore')
const {
    ARTIFACT_SOURCES,
    ArtifactInputError,
    MAX_ARTIFACT_UPLOAD_BYTES,
    getFileNameFromPath,
    normalizeArtifactPath,
} = require('./artifactModel')

// "Save as artifact" on a file attachment that already lives in a chat or a note (decision 3 of
// ARTIFACTS_PLAN.md: existing attachments never become artifacts on their own). The attachment is
// copied, not moved: the comment keeps its download link, and the artifact gets its own bytes and
// its own access rules.
//
// The client hands over the attachment's download URL, so everything about that URL is checked
// before a byte is read. It must point at THIS project's default bucket (no fetching of arbitrary
// URLs), at one of the folders the app stores attachments in, and carry a download token the file
// really has — the token is what makes an attachment URL a capability, so a caller who only guessed
// a path learns nothing and copies nothing.

const ATTACHMENT_PREFIXES = ['attachments/', 'feedAttachments/', 'notesAttachments/']
const STORAGE_HOST = 'firebasestorage.googleapis.com'

function notFound() {
    return new HttpsError('not-found', 'Attachment not found.')
}

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

function hasDownloadToken(metadata, token) {
    const tokens = String(metadata?.metadata?.firebaseStorageDownloadTokens || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    return tokens.includes(token)
}

// The name the file is stored under inside the artifact: what the user sees on the chip, else the
// stored name. Only the last segment, so a crafted name cannot place the file in a folder.
function resolveArtifactFileName(fileName, storagePath) {
    for (const candidate of [fileName, getFileNameFromPath(storagePath)]) {
        const lastSegment = String(candidate || '')
            .split(/[\\/]/)
            .pop()
            .trim()
        if (!lastSegment) continue
        try {
            return normalizeArtifactPath(lastSegment)
        } catch (_) {
            // try the next candidate
        }
    }
    return 'attachment'
}

async function assertProjectMember(db, projectId, userId) {
    const snapshot = await db.doc(`projects/${projectId}`).get()
    const userIds = snapshot.exists && Array.isArray(snapshot.data().userIds) ? snapshot.data().userIds : []
    if (!userIds.includes(userId)) throw new HttpsError('permission-denied', 'You are not a member of this project.')
}

async function saveAttachmentAsArtifact({
    userId,
    projectId,
    url,
    fileName,
    db = admin.firestore(),
    bucket = admin.storage().bucket(),
    ...commitOptions
}) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId || typeof projectId !== 'string')
        throw new HttpsError('invalid-argument', 'A projectId is required.')
    const attachment = parseAttachmentUrl(url, bucket.name)
    if (!attachment) throw new HttpsError('invalid-argument', 'This is not an attachment that can be saved.')

    await assertProjectMember(db, projectId, userId)

    const file = bucket.file(attachment.path)
    let metadata
    try {
        ;[metadata] = await file.getMetadata()
    } catch (_) {
        throw notFound()
    }
    if (!hasDownloadToken(metadata, attachment.token)) throw notFound()
    if (Number(metadata.size) > MAX_ARTIFACT_UPLOAD_BYTES) {
        throw new HttpsError('invalid-argument', 'The file is larger than 20 MB.')
    }

    const [bytes] = await file.download()
    try {
        // Private to the person saving it: the attachment may come from a conversation only some of
        // the project can read. Sharing it with the project is one click on the artifact.
        const result = await commitArtifactVersion({
            ...commitOptions,
            db,
            bucket,
            userId,
            projectId,
            files: [{ path: resolveArtifactFileName(fileName, attachment.path), base64: bytes.toString('base64') }],
            isPrivate: true,
            source: ARTIFACT_SOURCES.UPLOAD,
        })
        return { ...result, isPrivate: true }
    } catch (error) {
        if (error instanceof ArtifactInputError) throw new HttpsError('invalid-argument', error.message)
        throw error
    }
}

module.exports = {
    ATTACHMENT_PREFIXES,
    parseAttachmentUrl,
    resolveArtifactFileName,
    saveAttachmentAsArtifact,
}
