'use strict'

// Linked uploads (the files people uploaded into tasks, notes, goals and conversations) are found
// on the server and handed to the Artifacts tab in one callable answer (AT-2860).
//
// They used to be assembled in the browser from live listeners: one on every source collection of
// the project (all 22,798 tasks of the main project) and one per conversation that had a chat
// object. A single visit created ~28,000 Firestore targets and ~100 MB of cached documents, the
// client's Firestore queue stopped answering, and the app replaced itself every seven minutes.
//
// Here the project is read once in full, in resumable steps of SCAN_BUDGET_MS, and afterwards only
// what changed since the last call (`lastEditionDate`, a note's `uploadsRevision`, a chat object's
// `lastEditionDate` for new comments). What the scan keeps is a list of CANDIDATES — sources that
// embedded a file when they were read — never an answer: every call re-reads each candidate and
// its parent, so a source that was edited, deleted or made private since drops out at once, with
// the caller's own access decided the way the old listeners' queries and rules decided it.
// The index is server-only (`artifactUploadIndex/{projectId}`, no client rule) because it holds
// download URLs of sources the caller may not be allowed to read.
const Y = require('yjs')
const { extractAttachmentReferences } = require('./attachmentModel')
const {
    UPLOAD_SOURCES,
    commentReferences,
    mergeLinkedUploads,
    objectTextReferences,
    sourceTitle,
} = require('./linkedUploadsModel')
const { mapWithConcurrency } = require('../Utils/mapWithConcurrency')

const INDEX_COLLECTION = 'artifactUploadIndex'
const GLOBAL_ASSISTANTS_PATH = 'assistants/globalProject/items'

const OBJECT_FIELDS = [
    'description',
    'extendedName',
    'extendedTitle',
    'title',
    'displayName',
    'name',
    'isPublicFor',
    'readerIds',
    'lastEditionDate',
    'created',
    'type',
    'uploadsRevision',
]
const COMMENT_FIELDS = ['commentText', 'mediaContext', 'created', 'lastEditionDate']

// One call scans at most this long, so the callable answers well inside the client's timeout. A
// first scan of a large project takes a few calls; the client asks again while `complete` is false.
const SCAN_BUDGET_MS = 40 * 1000
const LEASE_MS = SCAN_BUDGET_MS + 30 * 1000
const PAGE_SIZE = 300
const NOTE_PAGE_SIZE = 50
const THREAD_PAGE_SIZE = 200
const THREAD_CONCURRENCY = 20
const NOTE_CONCURRENCY = 8
const READ_CHUNK = 200
// More changes than this since the last call means something bulk happened: read it all again.
const INCREMENTAL_LIMIT = 1000
// Edition stamps come from client clocks; re-reading a short window covers a clock that runs behind.
const WATERMARK_OVERLAP_MS = 10 * 60 * 1000
// Edits that stamp nothing (a comment edited in place) are caught by reading everything weekly.
const FULL_RESCAN_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const INCREMENTAL_MIN_INTERVAL_MS = 20 * 1000

const OBJECT_SOURCE_PATHS = Object.fromEntries(UPLOAD_SOURCES.map(({ type, path }) => [type, path]))
const NO_COMMENT_TYPES = new Set(UPLOAD_SOURCES.filter(source => source.noComments).map(source => source.type))

// The full scan: every object source, then every conversation with a chat object, then the member
// and assistant threads, which may predate chat objects.
const FULL_SCAN_STAGES = [
    ...UPLOAD_SOURCES.map(({ type }) => ({ kind: 'objects', type })),
    { kind: 'threads' },
    { kind: 'memberThreads' },
]

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'

// `uploadsRevision` is a push id, whose first eight characters encode its creation time.
function pushIdPrefixForTime(ms) {
    let remaining = Math.max(0, Math.floor(Number(ms) || 0))
    const chars = []
    for (let i = 0; i < 8; i++) {
        chars.unshift(PUSH_CHARS.charAt(remaining % 64))
        remaining = Math.floor(remaining / 64)
    }
    return chars.join('')
}

function readNoteUploadReferences(bytes, bucketName) {
    if (!bytes || !bytes.byteLength) return []
    const doc = new Y.Doc()
    try {
        Y.applyUpdate(doc, new Uint8Array(bytes))
        return extractAttachmentReferences(doc.getText('quill').toDelta(), bucketName)
    } finally {
        doc.destroy()
    }
}

const objectKey = (type, id) => `o~${type}~${id}`
const threadPrefix = (chatType, objectId) => `c~${chatType}~${objectId}~`
const commentKey = (chatType, objectId, commentId) => `${threadPrefix(chatType, objectId)}${commentId}`

// The same test the old listeners applied: their queries required the server-owned `readerIds`
// projection to name the caller, and the client then checked `isPublicFor` as well.
function canRead(data, userId) {
    if (!data) return false
    const isPublicFor = Array.isArray(data.isPublicFor) ? data.isPublicFor : null
    const readerIds = Array.isArray(data.readerIds) ? data.readerIds : null
    return (
        !!isPublicFor &&
        (isPublicFor.includes(0) || isPublicFor.includes(userId)) &&
        !!readerIds &&
        readerIds.includes(userId)
    )
}

function sameCandidate(a, b) {
    if (!a || !b) return false
    const { updatedAt: _a, ...left } = a
    const { updatedAt: _b, ...right } = b
    return JSON.stringify(left) === JSON.stringify(right)
}

function createCandidateStore(db, projectId, docs, now) {
    const collectionPath = `${INDEX_COLLECTION}/${projectId}/candidates`
    const entries = new Map(docs.map(doc => [doc.id, doc.data()]))
    const threads = new Map()
    const addToThread = key => {
        if (!key.startsWith('c~')) return
        const prefix = key.slice(0, key.lastIndexOf('~') + 1)
        if (!threads.has(prefix)) threads.set(prefix, new Set())
        threads.get(prefix).add(key)
    }
    for (const key of entries.keys()) addToThread(key)
    let batch = db.batch()
    let pending = 0
    // Threads and notes are scanned concurrently, so the batch is swapped before it is committed.
    const commit = async () => {
        if (!pending) return
        const full = batch
        batch = db.batch()
        pending = 0
        await full.commit()
    }
    const flushIfFull = () => (pending >= 400 ? commit() : undefined)
    return {
        entries,
        async upsert(key, data) {
            if (sameCandidate(entries.get(key), data)) return
            const stored = { ...data, updatedAt: now() }
            entries.set(key, stored)
            addToThread(key)
            batch.set(db.doc(`${collectionPath}/${key}`), stored)
            pending++
            await flushIfFull()
        },
        async remove(key) {
            if (!entries.has(key)) return
            entries.delete(key)
            const prefix = key.startsWith('c~') ? key.slice(0, key.lastIndexOf('~') + 1) : null
            if (prefix && threads.has(prefix)) threads.get(prefix).delete(key)
            batch.delete(db.doc(`${collectionPath}/${key}`))
            pending++
            await flushIfFull()
        },
        threadKeys(prefix) {
            return [...(threads.get(prefix) || [])]
        },
        flush: commit,
    }
}

function decideWork(state, time) {
    if (state.fullScan) return 'full'
    if (!state.fullScanCompletedAt) return 'full'
    if (time - state.fullScanCompletedAt > FULL_RESCAN_AFTER_MS) return 'full'
    if (!state.lastIncrementalAt || time - state.lastIncrementalAt >= INCREMENTAL_MIN_INTERVAL_MS) return 'incremental'
    return null
}

function createLinkedUploadsIndex({
    db,
    bucketName,
    loadNoteBody,
    documentId,
    now = () => Date.now(),
    budgetMs = SCAN_BUDGET_MS,
    ownerId = `scan-${Math.random().toString(36).slice(2)}`,
}) {
    const acquireScanLease = stateRef =>
        db.runTransaction(async transaction => {
            const snapshot = await transaction.get(stateRef)
            const state = snapshot.exists ? snapshot.data() || {} : {}
            const time = now()
            const work = decideWork(state, time)
            if (!work) return { state, work: null, busy: false }
            if (state.lease && state.lease.until > time && state.lease.owner !== ownerId) {
                return { state, work: null, busy: true }
            }
            transaction.set(stateRef, { lease: { owner: ownerId, until: time + LEASE_MS } }, { merge: true })
            return { state, work, busy: false }
        })

    const releaseScanLease = (stateRef, update) =>
        db.runTransaction(async transaction => {
            const snapshot = await transaction.get(stateRef)
            const state = snapshot.exists ? snapshot.data() || {} : {}
            // A lease that ran out was taken over; that scan owns the state now.
            if (state.lease && state.lease.owner !== ownerId) return state
            const next = { ...state, ...update, lease: null }
            transaction.set(stateRef, next)
            return next
        })

    const getProjectLinkedUploads = async ({ userId, projectId }) => {
        const projectSnapshot = await db.doc(`projects/${projectId}`).get()
        const project = projectSnapshot.exists ? projectSnapshot.data() || {} : {}
        const userIds = Array.isArray(project.userIds) ? project.userIds : []
        // Aggregated uploads are for members only; a public reader sees each source on its own.
        if (!userId || !userIds.includes(userId)) return { files: [], complete: true }

        const stateRef = db.doc(`${INDEX_COLLECTION}/${projectId}`)
        const lease = await acquireScanLease(stateRef)
        const candidateDocs = await db.collection(`${INDEX_COLLECTION}/${projectId}/candidates`).get()
        const candidates = createCandidateStore(db, projectId, candidateDocs.docs, now)

        let state = lease.state
        if (lease.work) {
            const deadline = now() + budgetMs
            const scanner = createScanner({ db, projectId, userIds, bucketName, loadNoteBody, documentId, candidates })
            let update = {}
            try {
                update =
                    lease.work === 'full'
                        ? await scanner.full(state, deadline, now)
                        : await scanner.incremental(state, deadline, now)
            } catch (error) {
                // The next call resumes from the last saved position; this one still answers.
                console.error('[linkedUploads] Scan failed', { projectId, work: lease.work, message: error?.message })
            }
            await candidates.flush()
            state = await releaseScanLease(stateRef, update)
        }

        const files = await answer({ db, projectId, userId, userIds, bucketName, candidates })
        await candidates.flush()
        const complete = !!state.fullScanCompletedAt
        return { files, complete, ...(complete ? {} : { retryAfterMs: lease.busy ? 5000 : 500 }) }
    }

    return { getProjectLinkedUploads }
}

function createScanner({ db, projectId, userIds, bucketName, loadNoteBody, documentId, candidates }) {
    const sourcePath = type => OBJECT_SOURCE_PATHS[type].replace('{p}', projectId)

    const processObjects = async (type, docs) => {
        if (type === 'notes') {
            await mapWithConcurrency(docs, NOTE_CONCURRENCY, async doc => {
                let bytes
                try {
                    bytes = await loadNoteBody(projectId, doc.id)
                } catch (error) {
                    // An unreadable body leaves what was known about the note as it was.
                    console.warn('[linkedUploads] Could not read a note body', { projectId, code: error?.code })
                    return
                }
                const references = readNoteUploadReferences(bytes, bucketName)
                if (references.length)
                    await candidates.upsert(objectKey(type, doc.id), {
                        kind: 'object',
                        type,
                        id: doc.id,
                        noteReferences: references,
                    })
                else await candidates.remove(objectKey(type, doc.id))
            })
            return
        }
        for (const doc of docs) {
            const data = doc.data() || {}
            // chatObjects also mirrors tasks, notes and the rest; only a topic is a source of its own.
            const isSource = type !== 'topics' || data.type === 'topics'
            if (isSource && objectTextReferences(type, data, bucketName).length)
                await candidates.upsert(objectKey(type, doc.id), { kind: 'object', type, id: doc.id })
            else await candidates.remove(objectKey(type, doc.id))
        }
    }

    const scanThread = async (chatType, objectId) => {
        if (!chatType || NO_COMMENT_TYPES.has(chatType)) return
        const snapshot = await db
            .collection(`chatComments/${projectId}/${chatType}/${objectId}/comments`)
            .select(...COMMENT_FIELDS)
            .get()
        const present = new Set()
        for (const doc of snapshot.docs) {
            if (!commentReferences(doc.data() || {}, bucketName).length) continue
            const key = commentKey(chatType, objectId, doc.id)
            present.add(key)
            await candidates.upsert(key, { kind: 'comment', type: chatType, id: objectId, commentId: doc.id })
        }
        for (const key of candidates.threadKeys(threadPrefix(chatType, objectId)))
            if (!present.has(key)) await candidates.remove(key)
    }

    const scanThreads = docs =>
        mapWithConcurrency(docs, THREAD_CONCURRENCY, doc => scanThread((doc.data() || {}).type, doc.id))

    const memberThreadIds = async () => {
        const [projectAssistants, globalAssistants] = await Promise.all([
            db.collection(`assistants/${projectId}/items`).select().get(),
            db.collection(GLOBAL_ASSISTANTS_PATH).select().get(),
        ])
        return [
            ...userIds.map(id => ['users', id]),
            ...[...projectAssistants.docs, ...globalAssistants.docs].map(doc => ['assistants', doc.id]),
        ]
    }

    const runStagePage = async (stage, cursor) => {
        if (stage.kind === 'memberThreads') {
            await mapWithConcurrency(await memberThreadIds(), THREAD_CONCURRENCY, ([type, id]) => scanThread(type, id))
            return null
        }
        const isThreads = stage.kind === 'threads'
        const pageSize = isThreads ? THREAD_PAGE_SIZE : stage.type === 'notes' ? NOTE_PAGE_SIZE : PAGE_SIZE
        let query = db
            .collection(isThreads ? sourcePath('topics') : sourcePath(stage.type))
            .orderBy(documentId)
            .limit(pageSize)
        query = isThreads ? query.select('type') : query.select(...OBJECT_FIELDS)
        if (cursor) query = query.startAfter(cursor)
        const snapshot = await query.get()
        if (isThreads) await scanThreads(snapshot.docs)
        else await processObjects(stage.type, snapshot.docs)
        return snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1].id : null
    }

    const full = async (state, deadline, now) => {
        const scan = state.fullScan ? { ...state.fullScan } : { startedAt: now(), stage: 0, cursor: null }
        while (scan.stage < FULL_SCAN_STAGES.length) {
            if (now() >= deadline) return { fullScan: scan }
            const next = await runStagePage(FULL_SCAN_STAGES[scan.stage], scan.cursor)
            if (next) scan.cursor = next
            else {
                scan.stage++
                scan.cursor = null
            }
        }
        const finishedAt = now()
        return {
            fullScan: null,
            fullScanCompletedAt: finishedAt,
            lastIncrementalAt: finishedAt,
            watermark: scan.startedAt - WATERMARK_OVERLAP_MS,
        }
    }

    const changedSince = (path, field, value, fields) =>
        db
            .collection(path)
            .where(field, '>', value)
            .orderBy(field)
            .limit(INCREMENTAL_LIMIT)
            .select(...fields)
            .get()

    const incremental = async (state, deadline, now) => {
        const startedAt = now()
        const since = Number(state.watermark) || 0
        const tooMany = snapshot => snapshot.docs.length >= INCREMENTAL_LIMIT
        const restart = { fullScan: { startedAt, stage: 0, cursor: null } }
        for (const { type } of UPLOAD_SOURCES) {
            if (now() >= deadline) return {}
            const snapshot = await changedSince(sourcePath(type), 'lastEditionDate', since, OBJECT_FIELDS)
            if (tooMany(snapshot)) return restart
            let docs = snapshot.docs
            if (type === 'notes') {
                // Finished uploads are announced on the note without touching its edition stamps.
                const uploads = await changedSince(sourcePath(type), 'uploadsRevision', pushIdPrefixForTime(since), [
                    'uploadsRevision',
                ])
                if (tooMany(uploads)) return restart
                const seen = new Set(docs.map(doc => doc.id))
                docs = [...docs, ...uploads.docs.filter(doc => !seen.has(doc.id))]
            }
            await processObjects(type, docs)
        }
        if (now() >= deadline) return {}
        // Every comment write stamps its chat object, so a changed conversation is read again whole.
        const chats = await changedSince(sourcePath('topics'), 'lastEditionDate', since, ['type'])
        if (tooMany(chats)) return restart
        await scanThreads(chats.docs)
        if (now() >= deadline) return {}
        return { lastIncrementalAt: startedAt, watermark: startedAt - WATERMARK_OVERLAP_MS }
    }

    return { full, incremental }
}

async function readAll(db, paths, fieldMask) {
    const unique = [...new Set(paths)]
    const result = new Map()
    for (let i = 0; i < unique.length; i += READ_CHUNK) {
        const chunk = unique.slice(i, i + READ_CHUNK)
        const snapshots = await db.getAll(...chunk.map(path => db.doc(path)), { fieldMask })
        snapshots.forEach((snapshot, index) => result.set(chunk[index], snapshot.exists ? snapshot.data() || {} : null))
    }
    return result
}

// Where the thread or object behind a candidate is read, and how it decides access.
function parentPaths(projectId, type, id) {
    if (type === 'assistants') return [`assistants/${projectId}/items/${id}`, `${GLOBAL_ASSISTANTS_PATH}/${id}`]
    if (type === 'users') return [`users/${id}`]
    if (type === 'contacts') return [`projectsContacts/${projectId}/contacts/${id}`, `users/${id}`]
    const path = OBJECT_SOURCE_PATHS[type]
    return path ? [`${path.replace('{p}', projectId)}/${id}`] : []
}

function resolveParent({ projectId, type, id, userId, userIds, parents }) {
    const [primaryPath, secondaryPath] = parentPaths(projectId, type, id)
    const primary = primaryPath ? parents.get(primaryPath) : null
    if (type === 'assistants') {
        const data = primary || parents.get(secondaryPath)
        return data ? { exists: true, readable: true, data: { ...data, isPublicFor: [0] } } : { exists: false }
    }
    // A conversation with a project member is open to every member, as its rule says.
    const memberThread = type === 'users' || (type === 'contacts' && !primary)
    if (memberThread) {
        if (!userIds.includes(id)) return { exists: false }
        const user = parents.get(`users/${id}`) || {}
        return { exists: true, readable: true, data: { ...user, isPublicFor: [0], name: user.displayName || id } }
    }
    if (!primary) return { exists: false }
    if (type === 'topics' && primary.type !== 'topics') return { exists: false }
    return { exists: true, readable: canRead(primary, userId), data: primary }
}

async function answer({ db, projectId, userId, userIds, bucketName, candidates }) {
    const list = [...candidates.entries.entries()]
    const parents = await readAll(
        db,
        list.flatMap(([, candidate]) => parentPaths(projectId, candidate.type, candidate.id)),
        OBJECT_FIELDS
    )
    const commentPath = candidate =>
        `chatComments/${projectId}/${candidate.type}/${candidate.id}/comments/${candidate.commentId}`
    const comments = await readAll(
        db,
        list.filter(([, candidate]) => candidate.kind === 'comment').map(([, candidate]) => commentPath(candidate)),
        COMMENT_FIELDS
    )

    const entries = []
    const stale = []
    for (const [key, candidate] of list) {
        const parent = resolveParent({ projectId, type: candidate.type, id: candidate.id, userId, userIds, parents })
        if (!parent.exists) {
            stale.push(key)
            continue
        }
        if (!parent.readable) continue
        const { data } = parent
        const source = { type: candidate.type, id: candidate.id, title: sourceTitle(data) }
        const date = data.lastEditionDate || data.created
        const isPrivate = !data.isPublicFor.includes(0)
        if (candidate.kind === 'comment') {
            const comment = comments.get(commentPath(candidate))
            const references = comment ? commentReferences(comment, bucketName) : []
            if (!references.length) {
                stale.push(key)
                continue
            }
            entries.push({
                references,
                source: { ...source, commentId: candidate.commentId },
                date: comment.lastEditionDate || comment.created || date,
                isPrivate,
            })
            continue
        }
        const references = [
            ...objectTextReferences(candidate.type, data, bucketName),
            ...(Array.isArray(candidate.noteReferences) ? candidate.noteReferences : []),
        ]
        if (!references.length) {
            stale.push(key)
            continue
        }
        entries.push({ references, source, date, isPrivate })
    }
    // A source that is gone or no longer embeds anything is forgotten; one the caller may not read
    // stays, because other members may.
    for (const key of stale) await candidates.remove(key)
    return mergeLinkedUploads(entries)
}

let defaultIndex = null

function getDefaultIndex() {
    if (defaultIndex) return defaultIndex
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin')
    // eslint-disable-next-line global-require
    const { FieldPath } = require('firebase-admin/firestore')
    // eslint-disable-next-line global-require
    const { getNotesBucketName } = require('../shared/notesStorageBucket')
    const bucket = admin.storage().bucket()
    defaultIndex = createLinkedUploadsIndex({
        db: admin.firestore(),
        bucketName: bucket.name,
        documentId: FieldPath.documentId(),
        loadNoteBody: async (projectId, noteId) => {
            const file = admin.storage().bucket(getNotesBucketName()).file(`notesData/${projectId}/${noteId}`)
            try {
                const [bytes] = await file.download()
                return bytes
            } catch (error) {
                if (error?.code === 404) return null
                throw error
            }
        },
    })
    return defaultIndex
}

async function getProjectLinkedUploads({ userId, projectId }) {
    // eslint-disable-next-line global-require
    const { HttpsError } = require('firebase-functions/v2/https')
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId || typeof projectId !== 'string')
        throw new HttpsError('invalid-argument', 'A projectId is required.')
    return getDefaultIndex().getProjectLinkedUploads({ userId, projectId })
}

module.exports = {
    INDEX_COLLECTION,
    SCAN_BUDGET_MS,
    FULL_RESCAN_AFTER_MS,
    INCREMENTAL_LIMIT,
    WATERMARK_OVERLAP_MS,
    createLinkedUploadsIndex,
    getProjectLinkedUploads,
    pushIdPrefixForTime,
    readNoteUploadReferences,
}
