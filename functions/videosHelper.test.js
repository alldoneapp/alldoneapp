jest.mock('fluent-ffmpeg', () => jest.fn())
jest.mock('firebase-functions', () => ({ logger: { error: jest.fn() } }))

const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const { convertVideos, parseStorageDownloadUrl, sniffVideoInputFormat, runFfmpeg } = require('./videosHelper')

const BUCKET = 'alldonealeph.appspot.com'
const PATH = 'notesAttachments/08112026/abc123/video-record.webm'
const url = (path = PATH, token = 'tok-1', bucket = BUCKET) =>
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(60)])

function makeDeps({ members = ['u1'], tokens = 'tok-1', bytes = WEBM, rateCount = 0 } = {}) {
    const rateDoc = { exists: rateCount > 0, data: () => ({ windowStart: Date.now(), count: rateCount }) }
    const db = {
        collection: name => ({
            doc: id => ({
                id,
                get: async () => (name === 'projects' ? { exists: true, data: () => ({ userIds: members }) } : rateDoc),
            }),
        }),
        runTransaction: async fn => fn({ get: async () => rateDoc, set: jest.fn() }),
    }
    const download = jest.fn(async ({ destination }) => fs.promises.writeFile(destination, bytes))
    const upload = jest.fn(async () => {})
    const file = jest.fn(() => ({
        getMetadata: async () => [{ size: bytes.length, metadata: { firebaseStorageDownloadTokens: tokens } }],
        download,
    }))
    const bucket = { name: BUCKET, file, upload }
    const run = jest.fn(async (input, format, output) => fs.promises.writeFile(output, 'mp4'))
    return { db, bucket, runFfmpeg: run, now: () => 1700000000000, download, upload, file }
}

describe('convertVideos (NV-30)', () => {
    test('converts an uploaded note attachment and returns a download-token URL next to it', async () => {
        const deps = makeDeps()
        const result = await convertVideos({}, { videoUri: url(), projectId: 'p1' }, 'u1', deps)
        expect(deps.runFfmpeg).toHaveBeenCalledWith(expect.any(String), 'matroska', expect.any(String))
        const [, options] = deps.upload.mock.calls[0]
        expect(options.destination).toBe('notesAttachments/08112026/abc123/1700000000000.mp4')
        expect(result.url).toMatch(
            /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/alldonealeph\.appspot\.com\/o\/notesAttachments%2F08112026%2Fabc123%2F1700000000000\.mp4\?alt=media&token=/
        )
    })

    test.each([
        ['an arbitrary http URL', 'http://169.254.169.254/computeMetadata/v1/'],
        ['a file: URI', 'file:///etc/passwd'],
        ['a concat: URI', 'concat:/etc/passwd|/etc/hosts'],
        ['another bucket', url(PATH, 'tok-1', 'other-bucket')],
        ['a path outside notesAttachments', url('projectsContacts/p1/c1/x')],
        ['a download URL without its token', url(PATH, '')],
    ])('refuses %s without running ffmpeg', async (label, videoUri) => {
        const deps = makeDeps()
        await expect(convertVideos({}, { videoUri, projectId: 'p1' }, 'u1', deps)).rejects.toMatchObject({
            code: expect.stringMatching(/invalid-argument|not-found/),
        })
        expect(deps.runFfmpeg).not.toHaveBeenCalled()
    })

    test('refuses a wrong token like a missing file', async () => {
        const deps = makeDeps({ tokens: 'other-token' })
        await expect(convertVideos({}, { videoUri: url(), projectId: 'p1' }, 'u1', deps)).rejects.toMatchObject({
            code: 'not-found',
        })
        expect(deps.download).not.toHaveBeenCalled()
    })

    test('refuses a caller who is not a member of the project', async () => {
        const deps = makeDeps({ members: ['someone-else'] })
        await expect(convertVideos({}, { videoUri: url(), projectId: 'p1' }, 'u1', deps)).rejects.toMatchObject({
            code: 'permission-denied',
        })
    })

    test('refuses a file that is not WebM or MP4 (an HLS playlist, say)', async () => {
        const deps = makeDeps({ bytes: Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n') })
        await expect(convertVideos({}, { videoUri: url(), projectId: 'p1' }, 'u1', deps)).rejects.toMatchObject({
            code: 'invalid-argument',
        })
        expect(deps.runFfmpeg).not.toHaveBeenCalled()
    })

    test('is rate limited per user', async () => {
        const deps = makeDeps({ rateCount: 1000 })
        await expect(convertVideos({}, { videoUri: url(), projectId: 'p1' }, 'u1', deps)).rejects.toMatchObject({
            code: 'resource-exhausted',
        })
        expect(deps.download).not.toHaveBeenCalled()
    })

    test('ffmpeg reads only the local file with an explicit demuxer', async () => {
        const calls = []
        const command = new Proxy(
            {},
            {
                get: (target, prop) =>
                    function (...args) {
                        calls.push([prop, ...args])
                        if (prop === 'on' && args[0] === 'end') setImmediate(args[1])
                        return command
                    },
            }
        )
        await runFfmpeg('/tmp/x/input', 'mov', '/tmp/x/out.mp4', () => command)
        expect(calls).toEqual(
            expect.arrayContaining([
                ['input', '/tmp/x/input'],
                ['inputFormat', 'mov'],
                ['inputOptions', ['-protocol_whitelist', 'file']],
            ])
        )
    })

    test('parses only Firebase download URLs of the given bucket', () => {
        expect(parseStorageDownloadUrl(url(), BUCKET)).toEqual({ path: PATH, token: 'tok-1' })
        expect(parseStorageDownloadUrl('https://evil.example.com/v0/b/x/o/y?token=1', BUCKET)).toBe(null)
        expect(sniffVideoInputFormat(Buffer.from('\0\0\0\x18ftypmp42____'))).toBe('mov')
    })
})
