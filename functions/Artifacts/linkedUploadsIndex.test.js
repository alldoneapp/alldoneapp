'use strict'

const Y = require('yjs')
const { createMemoryFirestore, DOCUMENT_ID } = require('./__fixtures__/memoryFirestore')
const {
    FULL_RESCAN_AFTER_MS,
    INCREMENTAL_LIMIT,
    createLinkedUploadsIndex,
    pushIdPrefixForTime,
    readNoteUploadReferences,
} = require('./linkedUploadsIndex')

const bucketName = 'test.appspot.com'
const url = (path, token = 't') =>
    `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
const token = (path, name = 'report.pdf') => `EbDsQTD14ahtSR5${url(path)}EbDsQTD14ahtSR5${name}EbDsQTD14ahtSR5false`
const noteBytes = path => {
    const doc = new Y.Doc()
    doc.getText('quill').insertEmbed(0, { attachment: { uri: url(path), text: 'Note.pdf' } })
    const bytes = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    return bytes
}
const readable = (extra = {}) => ({ isPublicFor: [0], readerIds: [0, 'u', 'v'], lastEditionDate: 1, ...extra })

let db
let clock
let noteBodies
let index
const now = () => clock

const makeIndex = (options = {}) =>
    createLinkedUploadsIndex({
        db,
        bucketName,
        documentId: DOCUMENT_ID,
        now,
        loadNoteBody: async (projectId, noteId) => noteBodies.get(`${projectId}/${noteId}`) || null,
        ...options,
    })
const titles = result => result.files.map(file => file.title).sort()
const call = (userId = 'u') => index.getProjectLinkedUploads({ userId, projectId: 'p' })

beforeEach(() => {
    clock = 1000000
    noteBodies = new Map()
    db = createMemoryFirestore({
        'projects/p': { userIds: ['u', 'v'] },
        'items/p/tasks/t1': readable({ description: token('attachments/c1/spec.pdf', 'spec.pdf'), name: 'Task one' }),
        'items/p/tasks/t2': readable({ name: 'Quiet task' }),
        'items/p/tasks/secret': {
            isPublicFor: ['v'],
            readerIds: ['v'],
            description: token('attachments/c9/secret.pdf', 'secret.pdf'),
        },
        'noteItems/p/notes/n1': readable({ title: 'Meeting' }),
        'chatObjects/p/chats/t1': readable({ type: 'tasks' }),
        'chatComments/p/tasks/t1/comments/c1': { commentText: token('attachments/c2/minutes.pdf', 'minutes.pdf') },
        'chatComments/p/tasks/t1/comments/c2': { commentText: 'no file here' },
        'chatObjects/p/chats/topic': readable({ type: 'topics', title: 'Kickoff' }),
        'chatComments/p/topics/topic/comments/c3': { commentText: token('attachments/c3/deck.pptx', 'deck.pptx') },
        // A member conversation and an assistant thread may have no chat object at all.
        'users/v': { displayName: 'Vera' },
        'chatComments/p/users/v/comments/c4': {
            mediaContext: [{ storageUrl: url('attachments/c4/photo.png'), fileName: 'photo.png' }],
        },
        'assistants/p/items/a': { name: 'Anna' },
        'chatComments/p/assistants/a/comments/c5': { commentText: token('attachments/c5/plan.pdf', 'plan.pdf') },
    })
    noteBodies.set('p/n1', noteBytes('notesAttachments/n1/note.pdf'))
    index = makeIndex()
})

it('finds uploads in objects, note bodies and every kind of conversation in one scan', async () => {
    const result = await call()
    expect(result.complete).toBe(true)
    expect(titles(result)).toEqual(['Note.pdf', 'deck.pptx', 'minutes.pdf', 'photo.png', 'plan.pdf', 'spec.pdf'])
    const minutes = result.files.find(file => file.title === 'minutes.pdf')
    expect(minutes.linkedSources).toEqual([{ type: 'tasks', id: 't1', title: 'Task one', commentId: 'c1' }])
    const photo = result.files.find(file => file.title === 'photo.png')
    expect(photo.linkedSources[0]).toMatchObject({ type: 'users', id: 'v', title: 'Vera' })
})

// AT-2868: a meeting recorder embeds its screenshots through markdown (`![Screenshot at 3:00](…)`),
// so the embed's text is a caption with no extension. The row must still be an image with a preview.
it('lists a meeting screenshot captioned without a file name as an image with its preview', async () => {
    const path = 'notesAttachments/26102026/abc/Meeting 2026-10-26 12.32 screenshot 1.jpg'
    const doc = new Y.Doc()
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    // eslint-disable-next-line global-require
    const { insertMarkdownToYjs } = require('../Assistant/markdownToYjs')
    insertMarkdownToYjs(
        doc.getText('quill'),
        0,
        `**Speaker 1** _[3:00]_\nHere.\n\n![Screenshot at 3:00](<${url(path)}>)`,
        {
            editorId: 'meeting',
        }
    )
    log.mockRestore()
    noteBodies.set('p/meeting', Y.encodeStateAsUpdate(doc))
    doc.destroy()
    db.store.set('noteItems/p/notes/meeting', readable({ title: '12:32 | 26.10.2026 | ERP MCP Product use case' }))

    const screenshot = (await call()).files.find(file => file.title === 'Screenshot at 3:00')
    expect(screenshot).toMatchObject({
        id: `upload:${path}`,
        kind: 'image',
        mimeType: 'image/jpeg',
        url: url(path),
        thumbnailUrl: url(path),
    })
    expect(screenshot.linkedSources).toEqual([
        { type: 'notes', id: 'meeting', title: '12:32 | 26.10.2026 | ERP MCP Product use case' },
    ])
})

it('lists nothing a caller could not read, and nothing at all for a non-member', async () => {
    expect(titles(await call('u'))).not.toContain('secret.pdf')
    expect(titles(await call('v'))).toContain('secret.pdf')
    expect(await call('stranger')).toEqual({ files: [], complete: true })
    // A source whose reader projection is missing is not shown, as the old query never returned it.
    db.store.set('items/p/tasks/t3', { isPublicFor: [0], description: token('attachments/c7/x.pdf', 'x.pdf') })
    clock += FULL_RESCAN_AFTER_MS + 1
    expect(titles(await call('u'))).not.toContain('x.pdf')
})

it('decides access and content when answering, not when scanning', async () => {
    await call()
    clock += 1000
    // No edition stamps moved, so no scan sees these changes; the answer still does.
    db.store.set('items/p/tasks/t1', readable({ description: 'attachment removed', name: 'Task one' }))
    db.store.set('chatObjects/p/chats/topic', { ...readable({ type: 'topics' }), isPublicFor: ['v'], readerIds: ['v'] })
    db.store.delete('chatComments/p/tasks/t1/comments/c1')
    const result = await call()
    expect(titles(result)).toEqual(['Note.pdf', 'photo.png', 'plan.pdf'])
    // Gone or emptied sources are forgotten; a source someone else may read is kept.
    expect(db.store.has('artifactUploadIndex/p/candidates/o~tasks~t1')).toBe(false)
    expect(db.store.has('artifactUploadIndex/p/candidates/c~tasks~t1~c1')).toBe(false)
    expect(db.store.has('artifactUploadIndex/p/candidates/c~topics~topic~c3')).toBe(true)
})

it('afterwards reads only what changed, picking up new files in objects, comments and note uploads', async () => {
    await call()
    db.reads.length = 0
    clock += 60 * 1000
    db.store.set(
        'items/p/tasks/t2',
        readable({
            name: 'Quiet task',
            lastEditionDate: clock,
            description: token('attachments/c8/new.pdf', 'new.pdf'),
        })
    )
    db.store.set('chatComments/p/topics/topic/comments/c6', {
        commentText: token('attachments/c6/late.pdf', 'late.pdf'),
    })
    db.store.set('chatObjects/p/chats/topic', readable({ type: 'topics', title: 'Kickoff', lastEditionDate: clock }))
    noteBodies.set('p/n1', noteBytes('notesAttachments/n1/second.pdf'))
    db.store.set(
        'noteItems/p/notes/n1',
        readable({ title: 'Meeting', uploadsRevision: `${pushIdPrefixForTime(clock)}abcd` })
    )

    const result = await call()
    expect(titles(result)).toEqual(
        expect.arrayContaining(['new.pdf', 'late.pdf', 'Note.pdf', 'minutes.pdf', 'spec.pdf'])
    )
    // The rewritten note body replaced its earlier file under the same name.
    expect(result.files.filter(file => file.title === 'Note.pdf').map(file => file.id)).toEqual([
        'upload:notesAttachments/n1/second.pdf',
    ])
    // Only the changed documents were read from the source collections, never the whole of them.
    expect(db.readsOf('items/p/tasks')).toBe(1)
    expect(db.readsOf('chatComments/p/tasks/t1/comments')).toBe(0)
})

it('rate-limits the change scan and rereads everything weekly', async () => {
    await call()
    db.reads.length = 0
    clock += 1000
    await call()
    expect(db.readsOf('items/p/tasks')).toBe(0)
    clock += FULL_RESCAN_AFTER_MS + 1
    await call()
    expect(db.readsOf('items/p/tasks')).toBe(3)
})

it('scans a large project in resumable steps and reports progress until complete', async () => {
    for (let i = 0; i < 700; i++) db.store.set(`items/p/tasks/bulk${String(i).padStart(4, '0')}`, readable())
    db.store.set('items/p/tasks/bulk0650', readable({ description: token('attachments/b/late.pdf', 'late.pdf') }))
    // Every page read moves the clock past the budget, so each call reads one page.
    const slowDb = db
    const originalCollection = slowDb.collection
    slowDb.collection = path => {
        const query = originalCollection(path)
        const wrap = q => ({
            ...q,
            where: (...args) => wrap(q.where(...args)),
            orderBy: (...args) => wrap(q.orderBy(...args)),
            startAfter: (...args) => wrap(q.startAfter(...args)),
            limit: (...args) => wrap(q.limit(...args)),
            select: (...args) => wrap(q.select(...args)),
            get: async () => {
                clock += 50 * 1000
                return q.get()
            },
        })
        return wrap(query)
    }
    let result = await call()
    expect(result.complete).toBe(false)
    expect(result.retryAfterMs).toBe(500)
    let calls = 1
    while (!result.complete && calls < 40) {
        result = await call()
        calls++
    }
    expect(result.complete).toBe(true)
    expect(calls).toBeGreaterThan(3)
    expect(titles(result)).toContain('late.pdf')
})

it('lets only one call scan at a time and tells the others to wait', async () => {
    db.store.set('artifactUploadIndex/p', { lease: { owner: 'someone-else', until: clock + 60000 } })
    const result = await call()
    expect(result).toMatchObject({ complete: false, retryAfterMs: 5000 })
    expect(db.readsOf('items/p/tasks')).toBe(0)
})

it('starts over with a full scan when more changed than one change scan should read', async () => {
    await call()
    clock += 60 * 1000
    for (let i = 0; i < INCREMENTAL_LIMIT; i++)
        db.store.set(`items/p/tasks/x${i}`, readable({ lastEditionDate: clock }))
    await call()
    expect(db.store.get('artifactUploadIndex/p').fullScan).toMatchObject({ stage: 0 })
})

it('treats a mirrored chat object as no source of its own', async () => {
    db.store.set(
        'chatObjects/p/chats/t2',
        readable({ type: 'tasks', description: token('attachments/m/mirror.pdf', 'mirror.pdf') })
    )
    expect(titles(await call())).not.toContain('mirror.pdf')
})

it('encodes times like push ids so note upload revisions compare by time', () => {
    expect(pushIdPrefixForTime(0)).toBe('--------')
    expect(pushIdPrefixForTime(1792997192423) < pushIdPrefixForTime(1792997192424)).toBe(true)
    expect(`${pushIdPrefixForTime(1792997192424)}xyz` > pushIdPrefixForTime(1792997192423)).toBe(true)
    expect(readNoteUploadReferences(null, bucketName)).toEqual([])
})

// AT-2887: tasks from 2020 carry the old "Someday" sentinel (Number.MAX_SAFE_INTEGER) as their
// edition stamp. Their uploads rendered as "Edited Invalid date" and sorted above every real file.
it('dates an upload by its source creation time when the edition stamp is a legacy sentinel', async () => {
    const created = Date.UTC(2023, 0, 11, 19, 45, 25)
    const recent = Date.UTC(2026, 9, 27, 9, 25)
    db.store.set(
        'items/p/tasks/legacy',
        readable({
            name: 'Level up popup',
            description: token('attachments/legacy/Bildschirmfoto.png', 'Bildschirmfoto.png'),
            lastEditionDate: Number.MAX_SAFE_INTEGER,
            created,
        })
    )
    db.store.set(
        'items/p/tasks/broken',
        readable({
            name: 'No usable date',
            description: token('attachments/broken/image.jpg', 'image.jpg'),
            lastEditionDate: Number.MAX_SAFE_INTEGER,
        })
    )
    db.store.set(
        'items/p/tasks/recent',
        readable({
            name: 'Recent',
            description: token('attachments/recent/Screenshot.png', 'Screenshot.png'),
            lastEditionDate: recent,
        })
    )

    const files = (await call()).files
    const byTitle = title => files.find(file => file.title === title)
    expect(byTitle('Bildschirmfoto.png').lastEditionDate).toBe(created)
    expect(byTitle('image.jpg').lastEditionDate).toBe(0)
    expect(byTitle('Screenshot.png').lastEditionDate).toBe(recent)
    const order = files.map(file => file.title)
    expect(order.indexOf('Screenshot.png')).toBeLessThan(order.indexOf('Bildschirmfoto.png'))
    expect(order.indexOf('Bildschirmfoto.png')).toBeLessThan(order.indexOf('image.jpg'))
    expect(files.every(file => file.lastEditionDate < 8.64e15)).toBe(true)
})
