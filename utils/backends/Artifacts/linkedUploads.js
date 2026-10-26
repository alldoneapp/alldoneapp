import * as Y from 'yjs'
import { cleanTextMetaData } from '../../../functions/Utils/parseTextUtils'

import { extractAttachmentReferences } from '../../../functions/Artifacts/attachmentModel'
import { getArtifactKindForMimeType, getMimeTypeForPath } from '../../../functions/Artifacts/artifactModel'
import { getNoteUploadsSignature } from './artifactsLocalCache'

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

const CHATS_PATH = 'chatObjects/{p}/chats'

// Threads that have no object document of their own, or are their own chat: they are always
// listened to. Every other object only has comments once a chat object exists for it, because each
// comment write creates or updates `chatObjects/{p}/chats/{objectId}` (chatsComments.js, and
// ensureChatExists on the server). Listening to the comments of an object without one cost one
// query per task, note and goal of the project, empty for almost all of them.
const ALWAYS_THREADED_TYPES = ['topics', 'users', 'assistants']

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

// Where a source is seen in context. `inThread` names a source's conversation rather than the
// object itself: where an assistant created an artifact, or where a file was sent as a comment.
export function getUploadSourcePath(projectId, source) {
    const project = encodeURIComponent(projectId)
    const id = encodeURIComponent(source.id)
    if (source.type === 'okrs') return `/project/${project}/okrs`
    const inThread = !!source.commentId || !!source.inThread
    if (source.type === 'artifacts') return `/projects/${project}/artifacts/${id}${inThread ? '/chat' : ''}`
    const type = source.type === 'topics' ? 'chats' : source.type === 'users' ? 'contacts' : source.type
    const tab =
        inThread || ['topics', 'users', 'assistants'].includes(source.type)
            ? 'chat'
            : source.type === 'notes'
              ? 'editor'
              : 'properties'
    return `/projects/${project}/${type}/${id}/${tab}`
}

export function sourceTitle(data) {
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

// Dependency injection keeps the access/lifecycle tests independent of the application's store.
// Firestore rules authorize every source and every comment query. The live isPublicFor check also
// removes access immediately while the server's readerIds projection catches up.
//
// `onChange(files, { settled })`: `settled` turns true once every source, every comment thread and
// every note body has answered once, and stays true. Until then the list is still filling in, which
// is what lets a caller keep showing the list it remembered instead of one that grows file by file.
// `noteUploadsCache` (artifactsLocalCache.js) remembers each note's attachments by its edition stamps.
export function watchLinkedUploads({
    db,
    projectId,
    userId,
    readerId,
    bucketName,
    loadNote,
    noteUploadsCache = null,
    onChange,
    onError,
}) {
    if (!db || !projectId || !userId || readerId === 0) {
        onChange([], { settled: true })
        return () => {}
    }
    let stopped = false
    let started = false
    let epoch = 0
    let settledOnce = false
    const parents = new Map()
    const collectionStops = []
    const pendingCollections = new Set()
    let chatIds = new Set()
    const noteQueue = []
    let activeNoteReads = 0
    const canRead = data =>
        Array.isArray(data.isPublicFor) && (data.isPublicFor.includes(0) || data.isPublicFor.includes(userId))
    const isSettled = () =>
        settledOnce ||
        (started &&
            pendingCollections.size === 0 &&
            [...parents.values()].every(parent => !parent.commentsPending && !parent.notePending))
    const emit = () => {
        if (stopped) return
        settledOnce = isSettled()
        onChange(mergeLinkedUploads([...parents.values()].flatMap(parent => parent.entries())), {
            settled: settledOnce,
        })
    }
    const report = error => onError?.(error)
    const drainNotes = () => {
        while (!stopped && activeNoteReads < 4 && noteQueue.length) {
            const job = noteQueue.shift()
            if (!job.current()) continue
            activeNoteReads++
            Promise.resolve()
                .then(job.run)
                .catch(error => {
                    // An unreadable body lists nothing of its own, but it has answered.
                    job.done()
                    emit()
                    report(error)
                })
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
    const syncComments = (key, parent) => {
        const wanted = !parent.noComments && (ALWAYS_THREADED_TYPES.includes(parent.type) || chatIds.has(parent.id))
        if (wanted && !parent.commentStop) {
            parent.commentsPending = true
            parent.commentStop = db
                .collection(`chatComments/${projectId}/${parent.type}/${parent.id}/comments`)
                .onSnapshot(
                    snapshot => {
                        if (stopped || parents.get(key) !== parent || !parent.commentStop) return
                        parent.comments = snapshot.docs
                        parent.commentsPending = false
                        emit()
                    },
                    error => {
                        if (stopped || parents.get(key) !== parent || !parent.commentStop) return
                        parent.comments = []
                        parent.commentsPending = false
                        emit()
                        report(error)
                    }
                )
        } else if (!wanted && parent.commentStop) {
            const stopComments = parent.commentStop
            parent.commentStop = null
            parent.comments = []
            parent.commentsPending = false
            stopComments()
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
            parent = {
                type,
                id,
                noComments,
                data,
                revision: 0,
                noteRefs: [],
                notePending: false,
                comments: [],
                commentStop: null,
                commentsPending: false,
                stop: () => {
                    parent.revision++
                    const stopComments = parent.commentStop
                    parent.commentStop = null
                    if (stopComments) stopComments()
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
        }
        syncComments(key, parent)
        const previous = parent.data
        parent.data = data
        if (
            type === 'notes' &&
            (parent.revision === 0 ||
                previous.lastEditionDate !== data.lastEditionDate ||
                previous.uploadsRevision !== data.uploadsRevision)
        ) {
            // The previous body's files stay listed until the new body has been read, so an edit
            // does not make a note's files blink out of the list.
            const revision = ++parent.revision
            const signature = getNoteUploadsSignature(data)
            const current = () => !stopped && parents.get(key) === parent && parent.revision === revision
            const done = () => {
                if (current()) parent.notePending = false
            }
            parent.notePending = true
            noteQueue.push({
                current,
                done,
                run: async () => {
                    if (!current()) return
                    let references = noteUploadsCache ? await noteUploadsCache.get(id, signature) : null
                    if (!current()) return
                    if (!references) {
                        const bytes = await loadNote(projectId, id)
                        if (!current()) return
                        references = readNoteUploadReferences(bytes, bucketName)
                        if (noteUploadsCache) noteUploadsCache.set(id, signature, references)
                    }
                    parent.noteRefs = references
                    done()
                    emit()
                },
            })
            drainNotes()
        }
    }
    const resyncAllComments = () => {
        for (const [key, parent] of parents) syncComments(key, parent)
    }
    const collectionKeys = new Map()
    const watchCollection = ({ type, path, noComments = false }, queryField = 'readerIds') => {
        collectionKeys.set(path, new Set())
        pendingCollections.add(path)
        const watchEpoch = epoch
        const isChats = path === CHATS_PATH.replace('{p}', projectId)
        const query = queryField
            ? db.collection(path).where(queryField, 'array-contains', readerId)
            : db.collection(path)
        collectionStops.push(
            query.onSnapshot(
                snapshot => {
                    if (stopped || watchEpoch !== epoch) return
                    pendingCollections.delete(path)
                    const present = new Set(snapshot.docs.map(doc => `${type}/${doc.id}`))
                    const oldKeys = collectionKeys.get(path)
                    collectionKeys.set(path, present)
                    for (const key of oldKeys) {
                        if (![...collectionKeys.values()].some(keys => keys.has(key))) remove(key)
                    }
                    if (isChats) chatIds = new Set(snapshot.docs.map(doc => doc.id))
                    for (const doc of snapshot.docs) upsert(type, doc.id, doc.data(), noComments)
                    if (isChats) resyncAllComments()
                    emit()
                },
                error => {
                    if (stopped || watchEpoch !== epoch) return
                    pendingCollections.delete(path)
                    const oldKeys = collectionKeys.get(path)
                    collectionKeys.set(path, new Set())
                    for (const key of oldKeys) {
                        if (![...collectionKeys.values()].some(keys => keys.has(key))) remove(key)
                    }
                    if (isChats) {
                        chatIds = new Set()
                        resyncAllComments()
                    }
                    emit()
                    report(error)
                }
            )
        )
    }
    const stopEverything = () => {
        epoch++
        collectionKeys.clear()
        pendingCollections.clear()
        chatIds = new Set()
        collectionStops.splice(0).forEach(stop => stop())
        for (const key of parents.keys()) remove(key)
        started = false
        // Losing the project is a complete answer: nothing of it may stay on screen.
        settledOnce = true
    }
    // Membership is an additional gate; uploaded-file aggregation never creates public visibility.
    const projectStop = db.doc(`projects/${projectId}`).onSnapshot(
        snapshot => {
            if (stopped) return
            const project = snapshot.exists ? snapshot.data() : {}
            if (!project.userIds?.includes(userId)) {
                stopEverything()
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
            stopEverything()
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
