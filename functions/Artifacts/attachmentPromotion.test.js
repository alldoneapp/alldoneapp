const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const { ArtifactBucketDouble } = require('./__fixtures__/artifactBucketDouble')
const { parseAttachmentUrl, resolveArtifactFileName, saveAttachmentAsArtifact } = require('./attachmentPromotion')

const PROJECT_ID = 'project-a'
const BUCKET = 'alldone-test.appspot.com'
const PATH = 'attachments/comment-1/Q3 report.pdf'
const TOKEN = 'token-1'

const urlFor = (path = PATH, token = TOKEN, bucket = BUCKET) =>
    `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`

let db
let bucket

beforeEach(async () => {
    db = new KnowledgeFirestoreDouble({ [`projects/${PROJECT_ID}`]: { userIds: ['owner', 'teammate'] } })
    bucket = new ArtifactBucketDouble(BUCKET)
    await bucket.file(PATH).save(Buffer.from('%PDF-1.7 report'), {
        metadata: { metadata: { firebaseStorageDownloadTokens: `other-token,${TOKEN}` } },
    })
})

const save = overrides =>
    saveAttachmentAsArtifact({ db, bucket, userId: 'owner', projectId: PROJECT_ID, url: urlFor(), ...overrides })

describe('parseAttachmentUrl', () => {
    it('accepts an attachment download URL of this bucket and nothing else', () => {
        expect(parseAttachmentUrl(urlFor(), BUCKET)).toEqual({ path: PATH, token: TOKEN })
        expect(parseAttachmentUrl(urlFor('notesAttachments/01012026/abc/a.png'), BUCKET)).not.toBeNull()
        expect(parseAttachmentUrl(urlFor(PATH, TOKEN, 'someone-elses-bucket'), BUCKET)).toBeNull()
        expect(parseAttachmentUrl(urlFor('artifacts/project-a/x/v1/index.html'), BUCKET)).toBeNull()
        expect(parseAttachmentUrl(urlFor('attachments/../users/x'), BUCKET)).toBeNull()
        expect(parseAttachmentUrl(urlFor().replace(`&token=${TOKEN}`, ''), BUCKET)).toBeNull()
        expect(
            parseAttachmentUrl(
                urlFor().replace('https://firebasestorage.googleapis.com', 'https://evil.example'),
                BUCKET
            )
        ).toBeNull()
        expect(parseAttachmentUrl('not a url', BUCKET)).toBeNull()
    })

    it('stores the file under its own name only', () => {
        expect(resolveArtifactFileName('Q3 report.pdf', PATH)).toBe('Q3 report.pdf')
        expect(resolveArtifactFileName('../../evil.html', PATH)).toBe('evil.html')
        expect(resolveArtifactFileName('', PATH)).toBe('Q3 report.pdf')
    })
})

describe('saveAttachmentAsArtifact', () => {
    it('copies the attachment into a new private artifact of the person saving it', async () => {
        const result = await save({ fileName: 'Q3 report.pdf' })

        expect(result).toMatchObject({ created: true, versionNumber: 1, isPrivate: true })
        const artifact = db.read(`artifactItems/${PROJECT_ID}/artifacts/${result.artifactId}`)
        expect(artifact).toMatchObject({
            title: 'Q3 report',
            kind: 'pdf',
            source: 'upload',
            userId: 'owner',
            isPrivate: true,
            isPublicFor: ['owner'],
        })
        const stored = [...bucket.files.keys()].filter(path => path.startsWith(`artifacts/${PROJECT_ID}/`))
        expect(stored).toHaveLength(1)
        expect(bucket.files.get(stored[0]).bytes.toString()).toBe('%PDF-1.7 report')
        // The comment keeps its own file.
        expect(bucket.files.has(PATH)).toBe(true)
    })

    it('reports a wrong token exactly like a missing file', async () => {
        await expect(save({ url: urlFor(PATH, 'guessed') })).rejects.toMatchObject({ code: 'not-found' })
        await expect(save({ url: urlFor('attachments/comment-1/missing.pdf') })).rejects.toMatchObject({
            code: 'not-found',
        })
    })

    it('refuses anybody outside the project before reading the file', async () => {
        const download = jest.spyOn(bucket, 'file')
        await expect(save({ userId: 'outsider' })).rejects.toMatchObject({ code: 'permission-denied' })
        expect(download).not.toHaveBeenCalled()
    })

    it('refuses a URL that is not an attachment of this app', async () => {
        await expect(save({ url: 'https://example.com/file.pdf' })).rejects.toMatchObject({ code: 'invalid-argument' })
    })
})
