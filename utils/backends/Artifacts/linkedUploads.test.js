import { getUploadSourcePath, mergeLinkedUploads, sourceTitle, UPLOAD_SOURCES } from './linkedUploads'

const bucketName = 'test.appspot.com'
// A real epoch-ms base: dates outside a plausible range are treated as unknown (AT-2887).
const T = Date.UTC(2026, 9, 1)
const url = (path, token = 't') =>
    `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`

// Finding uploads moved to the server (functions/Artifacts/linkedUploadsIndex.test.js); the client
// keeps the shared model and the navigation to a file's source.

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
    expect(getUploadSourcePath('p', { type: 'okrs', id: 'o' })).toBe('/project/p/okrs')
})

it('keeps the shared source list and titles the client uses for an artifact context', () => {
    expect(UPLOAD_SOURCES.map(source => source.type)).toEqual([
        'tasks',
        'notes',
        'goals',
        'contacts',
        'skills',
        'topics',
        'artifacts',
        'okrs',
    ])
    expect(sourceTitle({ title: 'Kickoff', name: 'ignored' })).toBe('Kickoff')
})

it('keeps same-named distinct files separate and mints no address of its own', () => {
    const files = mergeLinkedUploads([
        {
            references: ['a', 'b'].map(id => ({ path: `attachments/${id}/report.pdf`, fileName: 'report.pdf' })),
            source: { type: 'tasks', id: 't' },
            date: T + 1,
        },
    ])
    expect(files).toHaveLength(2)
    expect(files.map(file => file.url)).toEqual([null, null])
})

// AT-2868: an embed's display text is not always a file name ("Screenshot at 3:00" for a meeting
// screenshot). The stored object's own name then decides the type, so the row gets its preview.
it('types a file by its stored name when its display name has no known extension', () => {
    const path = 'notesAttachments/26102026/abc/Meeting 2026-10-26 12.32 screenshot 1.jpg'
    const [screenshot, clip, unknown] = mergeLinkedUploads([
        {
            references: [{ path, url: url(path), fileName: 'Screenshot at 3:00', thumbnailUrl: url(path) }],
            source: { type: 'notes', id: 'n' },
            date: T + 3,
        },
        {
            references: [{ path: 'notesAttachments/d/clip.mp4', fileName: 'Recording v1.2' }],
            source: { type: 'notes', id: 'n' },
            date: T + 2,
        },
        {
            references: [{ path: 'attachments/e/blob', fileName: 'Screenshot at 4:00' }],
            source: { type: 'tasks', id: 't' },
            date: T + 1,
        },
    ])
    expect(screenshot).toMatchObject({
        title: 'Screenshot at 3:00',
        kind: 'image',
        mimeType: 'image/jpeg',
        thumbnailUrl: url(path),
    })
    expect(clip).toMatchObject({ title: 'Recording v1.2', kind: 'video', mimeType: 'video/mp4' })
    // Nothing anywhere says what it is: it stays a generic file.
    expect(unknown).toMatchObject({ kind: 'file', mimeType: 'application/octet-stream' })
})

it('keeps the display name authoritative when it names a known type', () => {
    const [file] = mergeLinkedUploads([
        {
            references: [{ path: 'attachments/c/upload.bin', fileName: 'report.pdf' }],
            source: { type: 'tasks', id: 't' },
            date: T + 1,
        },
    ])
    expect(file).toMatchObject({ kind: 'pdf', mimeType: 'application/pdf' })
})

it('lists one file once across sources, private only if every source is private', () => {
    const [file] = mergeLinkedUploads([
        {
            references: [{ path: 'attachments/c/a.pdf' }],
            source: { type: 'tasks', id: 't' },
            date: T + 1,
            isPrivate: true,
        },
        {
            references: [{ path: 'attachments/c/a.pdf' }],
            source: { type: 'tasks', id: 't', commentId: 'c' },
            date: T + 3,
            isPrivate: false,
        },
    ])
    expect(file.linkedSources).toHaveLength(2)
    expect(file).toMatchObject({ isPrivate: false, lastEditionDate: T + 3 })
})

it('shows a file through the address its source already embeds, with the image thumbnail if any', () => {
    const image = url('attachments/c/shot.png')
    const thumbnail = url('attachments/c/shot_300x300.png')
    const [file] = mergeLinkedUploads([
        {
            references: [{ path: 'attachments/c/shot.png', url: image, fileName: 'shot.png' }],
            source: { type: 'tasks', id: 't' },
            date: T + 1,
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
            date: T + 2,
        },
    ])
    expect(file).toMatchObject({ kind: 'image', mimeType: 'image/png', url: image, thumbnailUrl: thumbnail })
    expect(file.linkedSources.map(source => source.type)).toEqual(['tasks', 'notes'])
})
