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
// An object's comments are only listened to once it has a chat object, as every comment write creates.
const chats = (...objects) =>
    send(
        'chatObjects/p/chats',
        objects.map(([type, id]) => [id, { type, isPublicFor: [0] }])
    )

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
    chats(['tasks', 't'])
    send('chatComments/p/tasks/t/comments', [['c', { commentText: token(path, 'Third.pdf') }]])
    await tick()
    expect(latest()).toHaveLength(1)
    expect(latest()[0].linkedSources).toHaveLength(3)
})

it('replaces edited comments and never resurrects a removed attachment from stale mediaContext', () => {
    send('items/p/tasks', [['t', parent()]])
    chats(['tasks', 't'])
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
    chats(['tasks', 't'])
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
        expect(change).toHaveBeenCalledWith([], { settled: true })
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
    // Where an assistant made an artifact: that object's conversation.
    expect(getUploadSourcePath('p', { type: 'tasks', id: 't', inThread: true })).toBe('/projects/p/tasks/t/chat')
    // An artifact opens in the artifacts view, its chat when a file was sent there.
    expect(getUploadSourcePath('p', { type: 'artifacts', id: 'a' })).toBe('/projects/p/artifacts/a')
    expect(getUploadSourcePath('p', { type: 'artifacts', id: 'a', commentId: 'c' })).toBe(
        '/projects/p/artifacts/a/chat'
    )
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

const settled = () => onChange.mock.calls.at(-1)?.[1]?.settled
const everySourcePath = () => [
    ...UPLOAD_SOURCES.map(({ path }) => path.replace('{p}', 'p')),
    'assistants/p/items',
    'assistants/globalProject/items',
]
const answerEverySource = (except = []) =>
    everySourcePath()
        .filter(path => !except.includes(path))
        .forEach(path => send(path, []))

it('listens to the comments of only the objects that have a chat, following chats as they come and go', () => {
    send('items/p/tasks', [
        ['quiet', parent()],
        ['talked', parent()],
    ])
    expect(listeners.has('chatComments/p/tasks/quiet/comments')).toBe(false)
    expect(listeners.has('chatComments/p/tasks/talked/comments')).toBe(false)

    chats(['tasks', 'talked'])
    expect(listeners.has('chatComments/p/tasks/quiet/comments')).toBe(false)
    send('chatComments/p/tasks/talked/comments', [['c', { commentText: token('attachments/c/a.pdf') }]])
    expect(latest()).toHaveLength(1)

    const commentListener = listeners.get('chatComments/p/tasks/talked/comments')
    chats()
    expect(commentListener.stop).toHaveBeenCalled()
    expect(latest()).toEqual([])
    commentListener.next(snapshot([['late', { commentText: token('attachments/c/a.pdf') }]]))
    expect(latest()).toEqual([])
})

it('still reads uploads in the object itself when it has no chat', () => {
    send('goals/p/items', [['g', parent(token('attachments/g/plan.pdf'))]])
    expect(latest().map(file => file.title)).toEqual(['report.pdf'])
    expect(listeners.has('chatComments/p/goals/g/comments')).toBe(false)
})

it('reports settled only once every source, comment thread and note body has answered', async () => {
    let finishNote
    loadNote.mockImplementationOnce(
        () =>
            new Promise(done => {
                finishNote = done
            })
    )
    expect(settled()).toBe(false)
    send('noteItems/p/notes', [['n', parent()]])
    send('items/p/tasks', [['t', parent()]])
    answerEverySource(['noteItems/p/notes', 'items/p/tasks', 'chatObjects/p/chats'])
    chats(['tasks', 't'])
    expect(settled()).toBe(false)

    send('chatComments/p/users/u/comments', [])
    send('chatComments/p/tasks/t/comments', [])
    await tick()
    expect(settled()).toBe(false)

    finishNote(noteBytes())
    await tick()
    expect(settled()).toBe(true)
    expect(latest().map(file => file.title)).toEqual(['Old.pdf'])

    // Later changes are live updates of a settled list, not a new first load.
    send('items/p/tasks', [['t', parent(token('attachments/t/new.pdf', 'new.pdf'))]])
    expect(settled()).toBe(true)
    expect(latest()).toHaveLength(2)
})

it('settles with whatever answered when a note body or a listener fails', async () => {
    loadNote.mockRejectedValueOnce(new Error('offline'))
    send('noteItems/p/notes', [['n', parent()]])
    answerEverySource(['noteItems/p/notes'])
    listeners.get('chatComments/p/users/u/comments').error({ code: 'permission-denied' })
    await tick()
    expect(settled()).toBe(true)
    expect(latest()).toEqual([])
    expect(onError).toHaveBeenCalledTimes(2)
})

it('settles at once, and empty, when the viewer is not a member', () => {
    send('items/p/tasks', [['t', parent(token('attachments/c/a.pdf'))]])
    project([])
    expect(latest()).toEqual([])
    expect(settled()).toBe(true)
})

it('keeps a note’s files listed while its edited body is read again', async () => {
    send('noteItems/p/notes', [['n', parent()]])
    await tick()
    expect(latest().map(file => file.title)).toEqual(['Old.pdf'])
    let finishNote
    loadNote.mockImplementationOnce(
        () =>
            new Promise(done => {
                finishNote = done
            })
    )
    send('noteItems/p/notes', [['n', parent('', { lastEditionDate: 2 })]])
    await tick()
    expect(latest().map(file => file.title)).toEqual(['Old.pdf'])
    finishNote(new Uint8Array())
    await tick()
    expect(latest()).toEqual([])
})

describe('remembered note attachments', () => {
    let cache
    beforeEach(() => {
        stop()
        listeners.clear()
        const stored = new Map()
        cache = {
            get: jest.fn(async (id, signature) => stored.get(`${id}@${signature}`) || null),
            set: jest.fn((id, signature, refs) => stored.set(`${id}@${signature}`, refs)),
        }
        stop = watchLinkedUploads({
            db,
            projectId: 'p',
            userId: 'u',
            readerId: 'u',
            bucketName,
            loadNote,
            noteUploadsCache: cache,
            onChange,
            onError,
        })
        project(['u'])
    })

    it('reads an unchanged note from what it found last time instead of downloading it again', async () => {
        send('noteItems/p/notes', [['n', parent()]])
        await tick()
        expect(loadNote).toHaveBeenCalledTimes(1)
        expect(cache.set).toHaveBeenCalledWith('n', '1|', [expect.objectContaining({ fileName: 'Old.pdf' })])

        // The tab is opened again: a new watcher, the same note.
        stop()
        listeners.clear()
        stop = watchLinkedUploads({
            db,
            projectId: 'p',
            userId: 'u',
            readerId: 'u',
            bucketName,
            loadNote,
            noteUploadsCache: cache,
            onChange,
            onError,
        })
        project(['u'])
        send('noteItems/p/notes', [['n', parent()]])
        await tick()
        expect(loadNote).toHaveBeenCalledTimes(1)
        expect(latest().map(file => file.title)).toEqual(['Old.pdf'])
    })

    it('downloads a note again once its edition stamps moved', async () => {
        send('noteItems/p/notes', [['n', parent()]])
        await tick()
        loadNote.mockResolvedValueOnce(noteBytes('notesAttachments/n/second.pdf'))
        send('noteItems/p/notes', [['n', parent('', { uploadsRevision: 'uploaded-2' })]])
        await tick()
        expect(loadNote).toHaveBeenCalledTimes(2)
        expect(cache.get).toHaveBeenLastCalledWith('n', '1|uploaded-2')
        expect(latest()[0].id).toBe('upload:notesAttachments/n/second.pdf')
    })

    it('never uses a remembered note the viewer can no longer read', async () => {
        await cache.set('n', '1|', [{ path: 'notesAttachments/n/old.pdf', fileName: 'Old.pdf' }])
        send('noteItems/p/notes', [['n', parent('', { isPublicFor: ['other'] })]])
        await tick()
        expect(cache.get).not.toHaveBeenCalled()
        expect(latest()).toEqual([])
    })
})
