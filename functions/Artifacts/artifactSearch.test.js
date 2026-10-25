'use strict'

jest.mock('firebase-admin', () => ({ storage: () => ({ bucket: () => null }), firestore: () => null }))

const { ArtifactBucketDouble } = require('./__fixtures__/artifactBucketDouble')
const { getArtifactFileStoragePath } = require('./artifactModel')
const {
    ARTIFACTS_SEARCH_COLLECTION,
    MAX_INDEXED_CHARS,
    artifactSearchUpdateNeeded,
    buildArtifactSearchRecord,
    extractArtifactSearchText,
    htmlToText,
    indexArtifactForSearch,
    removeArtifactFromSearch,
} = require('./artifactSearch')

const ARTIFACT = {
    title: 'Churn dashboard',
    description: 'Monthly churn per plan',
    kind: 'web',
    entryPath: 'index.html',
    mimeType: 'text/html',
    currentVersionId: 'v2',
    userId: 'owner',
    creatorId: 'owner',
    isPublicFor: [0, 'owner'],
    isPrivate: false,
    lastEditionDate: 1700000000000,
    created: 1690000000000,
    versionCount: 2,
    serveSecret: 'never-indexed-secret',
}

function typesenseDouble() {
    return {
        isTypesenseConfigured: () => true,
        upsertTypesenseDocument: jest.fn(async () => {}),
        deleteTypesenseDocument: jest.fn(async () => {}),
    }
}

function storeEntry(bucket, html, artifact = ARTIFACT) {
    bucket.files.set(getArtifactFileStoragePath('p1', 'a1', artifact.currentVersionId, artifact.entryPath), {
        bytes: Buffer.from(html, 'utf8'),
        options: {},
    })
}

describe('artifact search', () => {
    it('indexes the readable text of a web artifact, not its markup or scripts', async () => {
        const bucket = new ArtifactBucketDouble()
        storeEntry(
            bucket,
            '<html><head><style>.x{color:red}</style><script>const secret = "x"</script></head>' +
                '<body><h1>Churn&nbsp;by plan</h1><p>Pro &amp; Team</p><!-- hidden --></body></html>'
        )
        await expect(
            extractArtifactSearchText({ bucket, projectId: 'p1', artifactId: 'a1', artifact: ARTIFACT })
        ).resolves.toBe('Churn by plan Pro & Team')
    })

    it('indexes nothing for kinds that are not text, and survives a missing file', async () => {
        const bucket = new ArtifactBucketDouble()
        await expect(
            extractArtifactSearchText({
                bucket,
                projectId: 'p1',
                artifactId: 'a1',
                artifact: { ...ARTIFACT, kind: 'image' },
            })
        ).resolves.toBe('')
        await expect(
            extractArtifactSearchText({ bucket, projectId: 'p1', artifactId: 'a1', artifact: ARTIFACT })
        ).resolves.toBe('')
    })

    it('caps the indexed text', async () => {
        const bucket = new ArtifactBucketDouble()
        const artifact = { ...ARTIFACT, kind: 'text', entryPath: 'notes.txt' }
        storeEntry(bucket, 'word '.repeat(MAX_INDEXED_CHARS), artifact)
        const text = await extractArtifactSearchText({ bucket, projectId: 'p1', artifactId: 'a1', artifact })
        expect(text.length).toBe(MAX_INDEXED_CHARS)
    })

    it('builds a record with the access fields search filters on and without the serve secret', () => {
        const record = buildArtifactSearchRecord({
            projectId: 'p1',
            artifactId: 'a1',
            artifact: ARTIFACT,
            content: 'text',
        })
        expect(record).toMatchObject({
            objectID: 'a1p1',
            projectId: 'p1',
            title: 'Churn dashboard',
            description: 'Monthly churn per plan',
            content: 'text',
            isPublicFor: [0, 'owner'],
            isPrivate: false,
            userId: 'owner',
            lastEditionDate: 1700000000000,
        })
        expect(JSON.stringify(record)).not.toContain('never-indexed-secret')
    })

    it('re-indexes only for changes search can see', () => {
        expect(artifactSearchUpdateNeeded(ARTIFACT, { ...ARTIFACT, title: 'Renamed' })).toBe(true)
        expect(artifactSearchUpdateNeeded(ARTIFACT, { ...ARTIFACT, isPublicFor: ['owner'], isPrivate: true })).toBe(
            true
        )
        expect(artifactSearchUpdateNeeded(ARTIFACT, { ...ARTIFACT, currentVersionId: 'v3' })).toBe(true)
        expect(artifactSearchUpdateNeeded(ARTIFACT, { ...ARTIFACT, commentsData: { amount: 1 } })).toBe(false)
        expect(artifactSearchUpdateNeeded(ARTIFACT, { ...ARTIFACT, followersIds: ['u2'] })).toBe(false)
    })

    it('upserts into and removes from the artifacts collection', async () => {
        const typesense = typesenseDouble()
        const bucket = new ArtifactBucketDouble()
        storeEntry(bucket, '<p>Q3 numbers</p>')
        await indexArtifactForSearch({ projectId: 'p1', artifactId: 'a1', artifact: ARTIFACT, bucket, typesense })
        expect(typesense.upsertTypesenseDocument).toHaveBeenCalledWith(
            ARTIFACTS_SEARCH_COLLECTION,
            expect.objectContaining({ objectID: 'a1p1', content: 'Q3 numbers' })
        )
        await removeArtifactFromSearch({ projectId: 'p1', artifactId: 'a1', typesense })
        expect(typesense.deleteTypesenseDocument).toHaveBeenCalledWith(ARTIFACTS_SEARCH_COLLECTION, 'a1p1')
    })

    it('does nothing when search is not configured', async () => {
        const typesense = { ...typesenseDouble(), isTypesenseConfigured: () => false }
        await indexArtifactForSearch({
            projectId: 'p1',
            artifactId: 'a1',
            artifact: ARTIFACT,
            bucket: new ArtifactBucketDouble(),
            typesense,
        })
        expect(typesense.upsertTypesenseDocument).not.toHaveBeenCalled()
    })

    it('decodes numeric entities and keeps text outside tags', () => {
        expect(htmlToText('<b>5 &lt; 7</b> &#8364;10 &#x41;')).toBe(' 5 < 7  €10 A')
    })
})
