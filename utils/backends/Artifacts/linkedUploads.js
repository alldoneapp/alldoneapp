import * as Y from 'yjs'
import { cleanTextMetaData } from '../../../functions/Utils/parseTextUtils'

import { extractAttachmentReferences } from '../../../functions/Artifacts/attachmentModel'
import { getArtifactKindForMimeType, getMimeTypeForPath } from '../../../functions/Artifacts/artifactModel'

// A read-time view of the original documents, including documents written before this feature.
// Nothing is persisted: no copied bytes, reader lists, share links or migration to keep in sync.
export const UPLOAD_SOURCES = [
    { type: 'tasks', path: 'items/{p}/tasks' },
    { type: 'notes', path: 'noteItems/{p}/notes' },
    { type: 'goals', path: 'goals/{p}/items' },
    { type: 'contacts', path: 'projectsContacts/{p}/contacts' },
    { type: 'skills', path: 'skills/{p}/items' },
    { type: 'topics', path: 'chatObjects/{p}/chats' },
    { type: 'artifacts', path: 'artifactItems/{p}/artifacts' },
    { type: 'okrs', path: 'okrs/{p}/projectOkrs', noComments: true },
]

export function readNoteUploadReferences(bytes, bucketName) {
    if (!bytes || !bytes.byteLength) return []
    const doc = new Y.Doc()
    try {
        Y.applyUpdate(doc, new Uint8Array(bytes))
        return extractAttachmentReferences(doc.getText('quill').toDelta(), bucketName)
    } finally {
        doc.destroy()
    }
}

export function getUploadSourcePath(projectId, source) {
    if (source.type === 'okrs') return `/project/${encodeURIComponent(projectId)}/okrs`
    const type = source.type === 'topics' ? 'chats' : source.type === 'users' ? 'contacts' : source.type
    const tab =
        source.commentId || ['topics', 'users', 'assistants'].includes(source.type)
            ? 'chat'
            : source.type === 'notes'
              ? 'editor'
              : 'properties'
    return `/projects/${encodeURIComponent(projectId)}/${type}/${encodeURIComponent(source.id)}/${tab}`
}

function sourceTitle(data) {
    return cleanTextMetaData(
        String(data.extendedTitle || data.title || data.extendedName || data.displayName || data.name || '')
    )
}

export function mergeLinkedUploads(entries) {
    const files = new Map()
    for (const { references, source, date, isPrivate } of entries) {
        for (const reference of references) {
            let file = files.get(reference.path)
            if (!file) {
                const title = reference.fileName || reference.path.split('/').pop()
                const mimeType = getMimeTypeForPath(title)
                file = {
                    id: `upload:${reference.path}`,
                    title,
                    kind: getArtifactKindForMimeType(mimeType),
                    source: 'upload',
                    linkedUpload: true,
                    linkedSources: [],
                    isPrivate: true,
                    lastEditionDate: 0,
                }
                files.set(reference.path, file)
            }
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

// Dependency injection keeps the access/lifecycle tests independent of the application's store.
// Firestore rules authorize every source and every comment query. The live isPublicFor check also
// removes access immediately while the server's readerIds projection catches up.
export function watchLinkedUploads({ db, projectId, userId, readerId, bucketName, loadNote, onChange, onError }) {
    if (!db || !projectId || !userId || readerId === 0) {
        onChange([])
        return () => {}
    }
    let stopped = false
    let epoch = 0
    const parents = new Map()
    const collectionStops = []
    const noteQueue = []
    let activeNoteReads = 0
    const canRead = data =>
        Array.isArray(data.isPublicFor) && (data.isPublicFor.includes(0) || data.isPublicFor.includes(userId))
    const emit = () => {
        if (!stopped) onChange(mergeLinkedUploads([...parents.values()].flatMap(parent => parent.entries())))
    }
    const report = error => onError?.(error)
    const drainNotes = () => {
        while (!stopped && activeNoteReads < 4 && noteQueue.length) {
            const job = noteQueue.shift()
            if (!job.current()) continue
            activeNoteReads++
            Promise.resolve()
                .then(job.run)
                .catch(report)
                .finally(() => {
                    activeNoteReads--
                    drainNotes()
                })
        }
    }
    const remove = key => {
        const parent = parents.get(key)
        if (parent) {
            parents.delete(key)
            parent.stop()
        }
    }
    const upsert = (type, id, data, noComments = false) => {
        const key = `${type}/${id}`
        // chatObjects also contains mirrors of tasks/notes/etc.; their real parent is authoritative.
        if (type === 'assistants') data = { ...data, isPublicFor: [0] }
        if (!canRead(data) || (type === 'topics' && data.type !== 'topics')) {
            remove(key)
            return
        }
        let parent = parents.get(key)
        if (!parent) {
            let commentStop = () => {}
            parent = {
                data,
                revision: 0,
                noteRefs: [],
                comments: [],
                stop: () => {
                    parent.revision++
                    commentStop()
                },
                entries: () => {
                    const source = { type, id, title: sourceTitle(parent.data) }
                    const common = {
                        date: parent.data.lastEditionDate || parent.data.created,
                        isPrivate: !parent.data.isPublicFor.includes(0),
                    }
                    const textRefs =
                        type === 'notes'
                            ? []
                            : ['description', 'extendedName', 'extendedTitle'].flatMap(field =>
                                  extractAttachmentReferences(parent.data[field], bucketName)
                              )
                    return [
                        { ...common, source, references: [...textRefs, ...parent.noteRefs] },
                        ...parent.comments.map(doc => {
                            const comment = doc.data()
                            // The saved text is authoritative, never a stale mediaContext after editing.
                            const references =
                                typeof comment.commentText === 'string'
                                    ? extractAttachmentReferences(comment.commentText, bucketName)
                                    : (Array.isArray(comment.mediaContext) ? comment.mediaContext : []).flatMap(media =>
                                          extractAttachmentReferences(
                                              [
                                                  {
                                                      insert: {
                                                          attachment: { uri: media.storageUrl, text: media.fileName },
                                                      },
                                                  },
                                              ],
                                              bucketName
                                          )
                                      )
                            return {
                                ...common,
                                date: comment.lastEditionDate || comment.created || common.date,
                                source: { ...source, commentId: doc.id },
                                references,
                            }
                        }),
                    ]
                },
            }
            parents.set(key, parent)
            if (!noComments) {
                commentStop = db.collection(`chatComments/${projectId}/${type}/${id}/comments`).onSnapshot(
                    snapshot => {
                        if (stopped || parents.get(key) !== parent) return
                        parent.comments = snapshot.docs
                        emit()
                    },
                    error => {
                        if (stopped || parents.get(key) !== parent) return
                        parent.comments = []
                        emit()
                        report(error)
                    }
                )
            }
        }
        const previous = parent.data
        parent.data = data
        if (
            type === 'notes' &&
            (parent.revision === 0 ||
                previous.lastEditionDate !== data.lastEditionDate ||
                previous.uploadsRevision !== data.uploadsRevision)
        ) {
            const revision = ++parent.revision
            parent.noteRefs = []
            const current = () => !stopped && parents.get(key) === parent && parent.revision === revision
            noteQueue.push({
                current,
                run: async () => {
                    if (!current()) return
                    const bytes = await loadNote(projectId, id)
                    if (!current()) return
                    parent.noteRefs = readNoteUploadReferences(bytes, bucketName)
                    emit()
                },
            })
            drainNotes()
        }
    }
    const collectionKeys = new Map()
    const watchCollection = ({ type, path, noComments = false }, queryField = 'readerIds') => {
        collectionKeys.set(path, new Set())
        const watchEpoch = epoch
        const query = queryField
            ? db.collection(path).where(queryField, 'array-contains', readerId)
            : db.collection(path)
        collectionStops.push(
            query.onSnapshot(
                snapshot => {
                    if (stopped || watchEpoch !== epoch) return
                    const present = new Set(snapshot.docs.map(doc => `${type}/${doc.id}`))
                    const oldKeys = collectionKeys.get(path)
                    collectionKeys.set(path, present)
                    for (const key of oldKeys) {
                        if (![...collectionKeys.values()].some(keys => keys.has(key))) remove(key)
                    }
                    for (const doc of snapshot.docs) upsert(type, doc.id, doc.data(), noComments)
                    emit()
                },
                error => {
                    if (stopped || watchEpoch !== epoch) return
                    const oldKeys = collectionKeys.get(path)
                    collectionKeys.set(path, new Set())
                    for (const key of oldKeys) {
                        if (![...collectionKeys.values()].some(keys => keys.has(key))) remove(key)
                    }
                    emit()
                    report(error)
                }
            )
        )
    }
    let started = false
    // Membership is an additional gate; uploaded-file aggregation never creates public visibility.
    const projectStop = db.doc(`projects/${projectId}`).onSnapshot(
        snapshot => {
            if (stopped) return
            const project = snapshot.exists ? snapshot.data() : {}
            if (!project.userIds?.includes(userId)) {
                epoch++
                collectionKeys.clear()
                collectionStops.splice(0).forEach(stop => stop())
                for (const key of parents.keys()) remove(key)
                started = false
                emit()
                return
            }
            if (!started) {
                started = true
                UPLOAD_SOURCES.forEach(source =>
                    watchCollection({ ...source, path: source.path.replace('{p}', projectId) })
                )
                // User and assistant threads have no normal object in the collections above.
                watchCollection({ type: 'assistants', path: `assistants/${projectId}/items` }, null)
                watchCollection({ type: 'assistants', path: 'assistants/globalProject/items' }, null)
            }
            const userIds = new Set(project.userIds)
            for (const key of parents.keys()) if (key.startsWith('users/') && !userIds.has(key.slice(6))) remove(key)
            for (const id of userIds) upsert('users', id, { isPublicFor: [0], name: id })
            emit()
        },
        error => {
            if (stopped) return
            epoch++
            collectionKeys.clear()
            collectionStops.splice(0).forEach(stop => stop())
            for (const key of parents.keys()) remove(key)
            started = false
            emit()
            report(error)
        }
    )
    return () => {
        stopped = true
        projectStop()
        collectionStops.forEach(stop => stop())
        for (const key of parents.keys()) remove(key)
    }
}
