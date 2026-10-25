const Y = require('yjs')
const { extractAttachmentReferences, parseAttachmentUrl } = require('./attachmentModel')
const { getNoteDelta } = require('../QuillHelper')
const { buildAttachmentToken, buildImageToken, buildVideoToken } = require('../WhatsApp/whatsAppMediaTokens')

const BUCKET = 'alldone-test.appspot.com'
const urlFor = (path, token = 'token-1', bucket = BUCKET) =>
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`

it('recognizes only stored attachment capabilities in the deployment bucket', () => {
    for (const prefix of ['attachments', 'feedAttachments', 'notesAttachments']) {
        const path = `${prefix}/source/report.pdf`
        expect(parseAttachmentUrl(urlFor(path), BUCKET)).toEqual({ path, token: 'token-1' })
    }
    for (const url of [
        'blob:local-file',
        'data:image/png;base64,eA==',
        'https://example.com/report.pdf',
        urlFor('notesAttachments/x/report.pdf', 'token-1', 'other-bucket'),
        urlFor('artifacts/project/id/v1/report.pdf'),
        urlFor('notesAttachments/../private/report.pdf'),
        urlFor('notesAttachments/x/report.pdf', ''),
    ]) {
        expect(parseAttachmentUrl(url, BUCKET)).toBeNull()
    }
})

it('reads file, image and video comment tokens; a thumbnail only rides along with its image', () => {
    const file = urlFor('feedAttachments/date/id/report.pdf')
    const image = urlFor('notesAttachments/date/id/photo.png')
    const thumbnail = urlFor('notesAttachments/date/id/photo_300x300.png')
    const video = urlFor('feedAttachments/date/id/movie.mp4')
    const text = [
        buildAttachmentToken(file, 'report.pdf'),
        buildImageToken(image, thumbnail, 'photo.png'),
        buildVideoToken(video, 'movie.mp4'),
        buildAttachmentToken('https://example.com/external.pdf', 'external.pdf'),
    ].join(' ')

    expect(extractAttachmentReferences(text, BUCKET)).toEqual([
        { path: 'feedAttachments/date/id/report.pdf', url: file, fileName: 'report.pdf' },
        { path: 'notesAttachments/date/id/photo.png', url: image, fileName: 'photo.png', thumbnailUrl: thumbnail },
        { path: 'feedAttachments/date/id/movie.mp4', url: video, fileName: 'movie.mp4' },
    ])
})

it('keeps a thumbnail only when it is a stored attachment itself, and fills it in from a later embed', () => {
    const image = urlFor('notesAttachments/date/id/photo.png')
    const thumbnail = urlFor('notesAttachments/date/id/photo_300x300.png')
    expect(
        extractAttachmentReferences(buildImageToken(image, 'https://example.com/tracker.png', 'photo.png'), BUCKET)
    ).toEqual([{ path: 'notesAttachments/date/id/photo.png', url: image, fileName: 'photo.png' }])
    expect(
        extractAttachmentReferences(
            [
                { insert: { attachment: { uri: image, text: 'photo.png' } } },
                { insert: { customImageFormat: { uri: image, resizedUri: thumbnail, text: 'photo.png' } } },
            ],
            BUCKET
        )
    ).toEqual([
        { path: 'notesAttachments/date/id/photo.png', url: image, fileName: 'photo.png', thumbnailUrl: thumbnail },
    ])
})

it('deduplicates by stored path despite different tokens, names and embed formats', () => {
    const path = 'notesAttachments/date/id/report.pdf'
    const first = urlFor(path)
    const second = urlFor(path, 'rotated-token')
    expect(
        extractAttachmentReferences(
            [
                { insert: { attachment: { uri: first, text: 'Original name.pdf' } } },
                { insert: buildAttachmentToken(second, 'copy.pdf') },
                {
                    insert: {
                        attachment: { uri: urlFor('notesAttachments/another/id/report.pdf'), text: 'report.pdf' },
                    },
                },
            ],
            BUCKET
        )
    ).toEqual([
        { path, url: first, fileName: 'Original name.pdf' },
        {
            path: 'notesAttachments/another/id/report.pdf',
            url: urlFor('notesAttachments/another/id/report.pdf'),
            fileName: 'report.pdf',
        },
    ])
})

it('extracts current note embeds from a real saved Yjs document, excluding removed and draft files', () => {
    const document = new Y.Doc()
    const text = document.getText('quill')
    const image = urlFor('notesAttachments/date/id/photo.png')
    const video = urlFor('notesAttachments/date/id/movie.mp4')
    text.applyDelta([
        { insert: { attachment: { uri: urlFor('notesAttachments/date/id/removed.pdf'), text: 'removed.pdf' } } },
        { insert: { customImageFormat: { uri: image, text: 'photo.png' } } },
        { insert: { videoFormat: { uri: video, text: 'movie.mp4' } } },
        { insert: { attachment: { uri: 'blob:pending', text: 'draft.pdf', isNew: true } } },
    ])
    text.delete(0, 1)
    const delta = getNoteDelta(Y.encodeStateAsUpdate(document))
    document.destroy()

    expect(extractAttachmentReferences({ ops: delta }, BUCKET)).toEqual([
        { path: 'notesAttachments/date/id/photo.png', url: image, fileName: 'photo.png' },
        { path: 'notesAttachments/date/id/movie.mp4', url: video, fileName: 'movie.mp4' },
    ])
})

it('treats missing content and unrelated Quill formats as empty', () => {
    expect(extractAttachmentReferences(null, BUCKET)).toEqual([])
    expect(
        extractAttachmentReferences([{ insert: { mention: { uri: urlFor('attachments/a/x.pdf') } } }], BUCKET)
    ).toEqual([])
})
