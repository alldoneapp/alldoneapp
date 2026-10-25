import * as Y from 'yjs'
import {
    getUploadSourcePath,
    mergeLinkedUploads,
    readNoteUploadReferences,
    UPLOAD_SOURCES,
    watchLinkedUploads,
} from './linkedUploads'

const bucketName = 'test.appspot.com'
const url = (path, token = 't') =>
    `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
const token = (path, name = 'report.pdf', secret) =>
    `EbDsQTD14ahtSR5${url(path, secret)}EbDsQTD14ahtSR5${name}EbDsQTD14ahtSR5false`
const snapshot = entries => ({ docs: entries.map(([id, data]) => ({ id, data: () => data })) })
const noteBytes = (path = 'notesAttachments/n/old.pdf') => {
    const doc = new Y.Doc()
    doc.getText('quill').insertEmbed(0, { attachment: { uri: url(path), text: 'Old.pdf' } })
    const bytes = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    return bytes
}
const tick = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
}

let listeners, queries, onChange, onError, loadNote, stop, db
const latest = () => onChange.mock.calls.at(-1)?.[0] || []
const send = (path, entries) => listeners.get(path).next(snapshot(entries))
const project = userIds => listeners.get('projects/p').next({ exists: true, data: () => ({ userIds }) })
const parent = (description = '', extra = {}) => ({ isPublicFor: [0], description, lastEditionDate: 1, ...extra })

beforeEach(() => {
    listeners = new Map()
    queries = []
    const listen = path => ({
        onSnapshot: (next, error) => {
            const listener = { next, error, stop: jest.fn() }
            listeners.set(path, listener)
            return listener.stop
        },
    })
    db = {
        doc: path => listen(path),
        collection: path => ({
            ...listen(path),
            where: (...args) => {
                queries.push({ path, args })
                return listen(path)
            },
        }),
    }
    onChange = jest.fn()
    onError = jest.fn()
    loadNote = jest.fn(async () => noteBytes())
    stop = watchLinkedUploads({
        db,
        projectId: 'p',
        userId: 'u',
        readerId: 'u',
        bucketName,
        loadNote,
        onChange,
        onError,
    })
    project(['u'])
})
afterEach(() => stop())

it('queries every object source through its server-owned reader projection', () => {
    expect(queries).toEqual(
        UPLOAD_SOURCES.map(({ path }) => ({
            path: path.replace('{p}', 'p'),
            args: ['readerIds', 'array-contains', 'u'],
        }))
    )
})

it.each(UPLOAD_SOURCES.filter(source => source.type !== 'notes'))(
    'includes existing $type uploads without a write or backfill',
    ({ type, path }) => {
        send(path.replace('{p}', 'p'), [['old', parent(token('feedAttachments/old/report.pdf'), { type })]])
        expect(latest()).toEqual([
            expect.objectContaining({
                linkedUpload: true,
                title: 'report.pdf',
                kind: 'pdf',
                linkedSources: [{ type, id: 'old', title: '' }],
            }),
        ])
        // The backend double has no write methods: displaying existing sources is strictly read-only.
    }
)

it('reads current embeds from historical Yjs notes, not their stale preview text', async () => {
    send('noteItems/p/notes', [['n', parent('', { preview: token('attachments/deleted/stale.pdf') })]])
    await tick()
    expect(loadNote).toHaveBeenCalledWith('p', 'n')
    expect(latest().map(file => file.title)).toEqual(['Old.pdf'])
})

it('refreshes note content after the completed upload revision, including attachment removal', async () => {
    send('noteItems/p/notes', [['n', parent()]])
    await tick()
    loadNote.mockResolvedValueOnce(new Uint8Array())
    send('noteItems/p/notes', [['n', parent('', { uploadsRevision: 'uploaded-2' })]])
    await tick()
    expect(latest()).toEqual([])
    expect(loadNote).toHaveBeenCalledTimes(2)
})

it('deduplicates the same stored file across names, rotated tokens, fields and sources', async () => {
    const path = 'notesAttachments/n/old.pdf'
    send('noteItems/p/notes', [['n', parent()]])
    send('items/p/tasks', [['t', parent(token(path, 'Renamed.pdf', 'new-token'), { extendedName: token(path) })]])
    send('chatComments/p/tasks/t/comments', [['c', { commentText: token(path, 'Third.pdf') }]])
    await tick()
    expect(latest()).toHaveLength(1)
    expect(latest()[0].linkedSources).toHaveLength(3)
})

it('replaces edited comments and never resurrects a removed attachment from stale mediaContext', () => {
    send('items/p/tasks', [['t', parent()]])
    send('chatComments/p/tasks/t/comments', [['c', { commentText: token('attachments/c/report.pdf') }]])
    expect(latest()).toHaveLength(1)
    send('chatComments/p/tasks/t/comments', [
        ['c', { commentText: '', mediaContext: [{ storageUrl: url('attachments/c/report.pdf') }] }],
    ])
    expect(latest()).toEqual([])
    send('chatComments/p/tasks/t/comments', [])
    expect(latest()).toEqual([])
})

it('reads legacy mediaContext-only comments and all user/assistant thread uploads', () => {
    send('assistants/p/items', [['a', { name: 'Assistant' }]])
    for (const [type, id] of [
        ['users', 'u'],
        ['assistants', 'a'],
    ]) {
        send(`chatComments/p/${type}/${id}/comments`, [
            ['c', { mediaContext: [{ storageUrl: url(`attachments/${id}/report.pdf`), fileName: 'report.pdf' }] }],
        ])
    }
    expect(latest()).toHaveLength(2)
})

it('ignores mirrored chats and unauthorized sources even with stale readerIds', () => {
    send('chatObjects/p/chats', [['mirror', parent(token('attachments/c/a.pdf'), { type: 'tasks' })]])
    send('items/p/tasks', [['private', parent(token('attachments/c/a.pdf'), { isPublicFor: ['other'] })]])
    expect(latest()).toEqual([])
    expect(listeners.has('chatComments/p/tasks/private/comments')).toBe(false)
})

it('removes files on privacy changes, source deletion and denied comment reads', () => {
    send('items/p/tasks', [['t', parent(token('attachments/c/a.pdf'))]])
    expect(latest()).toHaveLength(1)
    const oldCommentListener = listeners.get('chatComments/p/tasks/t/comments')
    send('items/p/tasks', [['t', parent('', { isPublicFor: ['other'] })]])
    expect(latest()).toEqual([])
    expect(oldCommentListener.stop).toHaveBeenCalled()
    oldCommentListener.next(snapshot([['late', { commentText: token('attachments/c/a.pdf') }]]))
    expect(latest()).toEqual([])
    send('items/p/tasks', [['t', parent()]])
    send('chatComments/p/tasks/t/comments', [['c', { commentText: token('attachments/c/a.pdf') }]])
    listeners.get('chatComments/p/tasks/t/comments').error({ code: 'permission-denied' })
    expect(latest()).toEqual([])
    send('items/p/tasks', [['t', parent(token('attachments/c/a.pdf'))]])
    send('items/p/tasks', [])
    expect(latest()).toEqual([])
})

it('retains only the still-readable source when a duplicate source disappears', () => {
    for (const id of ['a', 'b'])
        send('items/p/tasks', [
            ['a', parent(token('attachments/shared/a.pdf'))],
            ...(id === 'b' ? [['b', parent(token('attachments/shared/a.pdf'))]] : []),
        ])
    send('items/p/tasks', [['b', parent(token('attachments/shared/a.pdf'))]])
    expect(latest()).toHaveLength(1)
    expect(latest()[0].linkedSources).toEqual([{ type: 'tasks', id: 'b', title: '' }])
    send('items/p/tasks', [])
    expect(latest()).toEqual([])
})

it('discards in-flight note content after access is revoked', async () => {
    let resolve
    loadNote.mockImplementationOnce(
        () =>
            new Promise(done => {
                resolve = done
            })
    )
    send('noteItems/p/notes', [['n', parent()]])
    await tick()
    send('noteItems/p/notes', [])
    resolve(noteBytes())
    await tick()
    expect(latest()).toEqual([])
})

it('drops every linked upload on membership loss and ignores late collection callbacks', () => {
    send('items/p/tasks', [['t', parent(token('attachments/c/a.pdf'))]])
    const taskListener = listeners.get('items/p/tasks')
    project([])
    expect(latest()).toEqual([])
    expect(taskListener.stop).toHaveBeenCalled()
    taskListener.next(snapshot([['t', parent(token('attachments/c/a.pdf'))]]))
    expect(latest()).toEqual([])
})

it('fails closed on collection and project errors', () => {
    send('items/p/tasks', [['t', parent(token('attachments/c/a.pdf'))]])
    listeners.get('items/p/tasks').error({ code: 'permission-denied' })
    expect(latest()).toEqual([])
    send('noteItems/p/notes', [['n', parent()]])
    listeners.get('projects/p').error({ code: 'permission-denied' })
    expect(latest()).toEqual([])
    expect(onError).toHaveBeenCalled()
})

it('offers no aggregated uploads to a public reader or unauthenticated visitor', () => {
    for (const identity of [
        { userId: null, readerId: 0 },
        { userId: 'guest', readerId: 0 },
    ]) {
        const change = jest.fn()
        watchLinkedUploads({ db, projectId: 'p', bucketName, ...identity, onChange: change })()
        expect(change).toHaveBeenCalledWith([])
    }
})

it('releases listeners and ignores async completions when the view closes', async () => {
    send('noteItems/p/notes', [['n', parent()]])
    stop()
    const count = onChange.mock.calls.length
    await tick()
    expect(onChange).toHaveBeenCalledTimes(count)
    expect([...listeners.values()].every(listener => listener.stop.mock.calls.length > 0)).toBe(true)
})

it('opens the original source editor or thread without a download capability', () => {
    expect(getUploadSourcePath('p', { type: 'notes', id: 'n' })).toBe('/projects/p/notes/n/editor')
    expect(getUploadSourcePath('p', { type: 'notes', id: 'n', commentId: 'c' })).toBe('/projects/p/notes/n/chat')
    expect(getUploadSourcePath('p', { type: 'topics', id: 'c' })).toBe('/projects/p/chats/c/chat')
    expect(getUploadSourcePath('p', { type: 'users', id: 'u' })).toBe('/projects/p/contacts/u/chat')
})

it('keeps same-named distinct files separate and mints no address of its own', () => {
    const files = mergeLinkedUploads([
        {
            references: ['a', 'b'].map(id => ({ path: `attachments/${id}/report.pdf`, fileName: 'report.pdf' })),
            source: { type: 'tasks', id: 't' },
            date: 1,
        },
    ])
    expect(files).toHaveLength(2)
    expect(files.map(file => file.url)).toEqual([null, null])
    expect(readNoteUploadReferences(null, bucketName)).toEqual([])
})

it('shows a file through the address its source already embeds, with the image thumbnail if any', () => {
    const image = url('attachments/c/shot.png')
    const thumbnail = url('attachments/c/shot_300x300.png')
    const [file] = mergeLinkedUploads([
        {
            references: [{ path: 'attachments/c/shot.png', url: image, fileName: 'shot.png' }],
            source: { type: 'tasks', id: 't' },
            date: 1,
        },
        {
            references: [
                {
                    path: 'attachments/c/shot.png',
                    url: url('attachments/c/shot.png', 'rotated'),
                    thumbnailUrl: thumbnail,
                },
            ],
            source: { type: 'notes', id: 'n' },
            date: 2,
        },
    ])
    expect(file).toMatchObject({ kind: 'image', mimeType: 'image/png', url: image, thumbnailUrl: thumbnail })
    expect(file.linkedSources.map(source => source.type)).toEqual(['tasks', 'notes'])
})
