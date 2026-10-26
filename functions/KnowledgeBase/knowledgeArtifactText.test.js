// The HTML reader lives in artifactSearch.js, which loads the Admin SDK and the search client; only
// its pure htmlToText is used here.
jest.mock('firebase-admin', () => ({ storage: () => ({ bucket: () => null }), firestore: () => null }))
jest.mock('../typesenseHelper', () => ({ ARTIFACTS_COLLECTION: 'artifacts' }))

const { readArtifactText } = require('./knowledgeArtifactText')

const PROJECT_ID = 'project-a'

function fakeBucket(files) {
    const downloads = []
    return {
        downloads,
        file(path) {
            return {
                async getMetadata() {
                    if (!files[path]) throw new Error('No such object')
                    return [{ size: files[path].length }]
                },
                async download() {
                    downloads.push(path)
                    return [Buffer.from(files[path])]
                },
            }
        },
    }
}

const storagePath = (artifactId, entryPath) => `artifacts/${PROJECT_ID}/${artifactId}/v1/${entryPath}`

describe('readArtifactText', () => {
    it('reads an HTML page as the text a visitor sees', async () => {
        const html =
            '<html><head><style>.x{color:red}</style><script>track()</script></head>' +
            '<body><h1>Churn</h1><p>Im Oktober 2&nbsp;%.</p></body></html>'
        const bucket = fakeBucket({ [storagePath('a1', 'index.html')]: html })

        const text = await readArtifactText({
            bucket,
            projectId: PROJECT_ID,
            artifactId: 'a1',
            artifact: { kind: 'web', currentVersionId: 'v1', entryPath: 'index.html' },
            maxChars: 1000,
        })

        expect(text).toBe('Churn Im Oktober 2 %.')
        expect(text).not.toMatch(/track|color/)
    })

    it('keeps the lines of a markdown file and cuts it to the budget', async () => {
        const bucket = fakeBucket({ [storagePath('a2', 'report.md')]: '# Bericht\n\n\n\n- Punkt eins\n- Punkt zwei' })

        const text = await readArtifactText({
            bucket,
            projectId: PROJECT_ID,
            artifactId: 'a2',
            artifact: { kind: 'markdown', currentVersionId: 'v1', entryPath: 'report.md' },
            maxChars: 20,
        })

        expect(text).toBe('# Bericht\n\n- Punkt e')
    })

    it('extracts a PDF through the document extraction', async () => {
        const bucket = fakeBucket({ [storagePath('a3', 'deck.pdf')]: '%PDF-1.4' })
        const extractDocumentText = jest.fn(async () => ({ extractedText: 'Folie 1\nFolie 2', status: 'ok' }))

        const text = await readArtifactText({
            bucket,
            projectId: PROJECT_ID,
            artifactId: 'a3',
            artifact: { kind: 'pdf', currentVersionId: 'v1', entryPath: 'deck.pdf' },
            maxChars: 1000,
            extractDocumentText,
        })

        expect(text).toBe('Folie 1\nFolie 2')
        expect(extractDocumentText).toHaveBeenCalledWith(
            expect.objectContaining({ fileName: 'deck.pdf', contentType: 'application/pdf', maxChars: 1000 })
        )
    })

    it('reads nothing from images, recordings, an SVG or an artifact without a version', async () => {
        const bucket = fakeBucket({})
        const extractDocumentText = jest.fn()
        const cases = [
            { kind: 'image', currentVersionId: 'v1', entryPath: 'photo.png' },
            { kind: 'audio', currentVersionId: 'v1', entryPath: 'call.mp3' },
            { kind: 'video', currentVersionId: 'v1', entryPath: 'demo.mp4' },
            { kind: 'image', currentVersionId: 'v1', entryPath: 'logo.svg' },
            { kind: 'web', currentVersionId: null, entryPath: 'index.html' },
        ]

        for (const artifact of cases) {
            await expect(
                readArtifactText({
                    bucket,
                    projectId: PROJECT_ID,
                    artifactId: 'x',
                    artifact,
                    maxChars: 1000,
                    extractDocumentText,
                })
            ).resolves.toBe('')
        }
        expect(bucket.downloads).toEqual([])
        expect(extractDocumentText).not.toHaveBeenCalled()
    })

    it('never throws when the file cannot be read', async () => {
        await expect(
            readArtifactText({
                bucket: fakeBucket({}),
                projectId: PROJECT_ID,
                artifactId: 'gone',
                artifact: { kind: 'text', currentVersionId: 'v1', entryPath: 'notes.txt' },
                maxChars: 1000,
            })
        ).resolves.toBe('')
    })
})
