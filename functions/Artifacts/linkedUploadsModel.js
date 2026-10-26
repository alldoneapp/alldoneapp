'use strict'

// What a linked upload is, shared by the server that finds them (linkedUploadsIndex.js) and the
// client that shows them (utils/backends/Artifacts/linkedUploads.js). Free of Firebase on purpose.
const { cleanTextMetaData } = require('../Utils/parseTextUtils')
const { extractAttachmentReferences } = require('./attachmentModel')
const { DEFAULT_MIME_TYPE, getArtifactKindForMimeType, getMimeTypeForPath } = require('./artifactModel')

const UPLOAD_SOURCES = [
    { type: 'tasks', path: 'items/{p}/tasks' },
    { type: 'notes', path: 'noteItems/{p}/notes' },
    { type: 'goals', path: 'goals/{p}/items' },
    { type: 'contacts', path: 'projectsContacts/{p}/contacts' },
    { type: 'skills', path: 'skills/{p}/items' },
    { type: 'topics', path: 'chatObjects/{p}/chats' },
    { type: 'artifacts', path: 'artifactItems/{p}/artifacts' },
    { type: 'okrs', path: 'okrs/{p}/projectOkrs', noComments: true },
]

// The fields of an object that may embed an attachment token. A note's are in its body instead.
const OBJECT_TEXT_FIELDS = ['description', 'extendedName', 'extendedTitle']

function sourceTitle(data) {
    return cleanTextMetaData(
        String(data.extendedTitle || data.title || data.extendedName || data.displayName || data.name || '')
    )
}

function objectTextReferences(type, data, bucketName) {
    if (type === 'notes') return []
    return OBJECT_TEXT_FIELDS.flatMap(field => extractAttachmentReferences(data[field], bucketName))
}

// The saved text is authoritative, never a stale mediaContext after editing.
function commentReferences(comment, bucketName) {
    if (typeof comment.commentText === 'string') return extractAttachmentReferences(comment.commentText, bucketName)
    return (Array.isArray(comment.mediaContext) ? comment.mediaContext : []).flatMap(media =>
        extractAttachmentReferences(
            [{ insert: { attachment: { uri: media.storageUrl, text: media.fileName } } }],
            bucketName
        )
    )
}

// The type of a linked upload. The display name decides first, as it always has, but an embed's
// display name is often not a file name at all: a meeting recorder's screenshot is embedded as
// "Screenshot at 3:00" while the stored object is `…/Meeting … screenshot 1.jpg`. Without an
// extension the name says nothing, so the stored object's own name answers instead (AT-2868).
function resolveUploadMimeType(title, path) {
    const fromTitle = getMimeTypeForPath(title)
    if (fromTitle !== DEFAULT_MIME_TYPE) return fromTitle
    return getMimeTypeForPath(path)
}

function mergeLinkedUploads(entries) {
    const files = new Map()
    for (const { references, source, date, isPrivate } of entries) {
        for (const reference of references) {
            let file = files.get(reference.path)
            if (!file) {
                const title = reference.fileName || reference.path.split('/').pop()
                const mimeType = resolveUploadMimeType(title, reference.path)
                // `url` is the download address the source itself embeds, so a reader of the source
                // already holds it; the list shows the file with it and creates no new address.
                file = {
                    id: `upload:${reference.path}`,
                    title,
                    kind: getArtifactKindForMimeType(mimeType),
                    mimeType,
                    url: reference.url || null,
                    thumbnailUrl: reference.thumbnailUrl || null,
                    source: 'upload',
                    linkedUpload: true,
                    linkedSources: [],
                    isPrivate: true,
                    lastEditionDate: 0,
                }
                files.set(reference.path, file)
            }
            if (!file.url && reference.url) file.url = reference.url
            if (!file.thumbnailUrl && reference.thumbnailUrl) file.thumbnailUrl = reference.thumbnailUrl
            if (
                !file.linkedSources.some(
                    existing =>
                        existing.type === source.type &&
                        existing.id === source.id &&
                        existing.commentId === source.commentId
                )
            )
                file.linkedSources.push(source)
            file.lastEditionDate = Math.max(file.lastEditionDate, Number(date) || 0)
            file.isPrivate = file.isPrivate && isPrivate
        }
    }
    return [...files.values()].sort((a, b) => b.lastEditionDate - a.lastEditionDate || a.id.localeCompare(b.id))
}

module.exports = {
    UPLOAD_SOURCES,
    OBJECT_TEXT_FIELDS,
    sourceTitle,
    objectTextReferences,
    commentReferences,
    mergeLinkedUploads,
}
