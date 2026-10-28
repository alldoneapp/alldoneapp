const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const { ArtifactBucketDouble } = require('./__fixtures__/artifactBucketDouble')
const { appendVmArtifactLinks, planVmOutputArtifacts, publishVmOutputArtifacts } = require('./vmArtifactPublisher')

const OUT = '/home/user/output'
const RUN_START = 1_800_000_000_000
const PROJECT_ID = 'project-a'
const BASE_URL = 'https://my.alldone.app'

// An E2B listing entry, written during this run unless `old` is set.
const entry = (relativePath, { size = 10, old = false } = {}) => ({
    type: 'file',
    name: relativePath.split('/').pop(),
    path: `${OUT}/${relativePath}`,
    size,
    modifiedTime: new Date(old ? RUN_START - 60 * 60 * 1000 : RUN_START + 1000).toISOString(),
})

const plan = listing => planVmOutputArtifacts(listing, { outputDir: OUT, sinceMs: RUN_START })
const summarize = groups =>
    groups.map(group => ({ outputPath: group.outputPath, paths: group.files.map(file => file.path).sort() }))

describe('planVmOutputArtifacts', () => {
    it('makes a folder with an index.html one bundle and every other file its own artifact', () => {
        const groups = plan([
            entry('dashboard/index.html'),
            entry('dashboard/assets/app.js'),
            entry('dashboard/data.json'),
            entry('report.pdf'),
            entry('notes/summary.md'),
        ])

        expect(summarize(groups)).toEqual([
            { outputPath: 'dashboard/', paths: ['assets/app.js', 'data.json', 'index.html'] },
            { outputPath: 'report.pdf', paths: ['report.pdf'] },
            { outputPath: 'notes/summary.md', paths: ['summary.md'] },
        ])
    })

    it('treats the whole output as one site when it has an index.html at the top', () => {
        const groups = plan([entry('index.html'), entry('style.css'), entry('img/logo.svg')])
        expect(summarize(groups)).toEqual([{ outputPath: '/', paths: ['img/logo.svg', 'index.html', 'style.css'] }])
    })

    it('publishes a bundle whole when one file changed, and skips what this run did not touch', () => {
        const groups = plan([
            entry('dashboard/index.html', { old: true }),
            entry('dashboard/data.json'),
            entry('old-report.pdf', { old: true }),
        ])
        expect(summarize(groups)).toEqual([{ outputPath: 'dashboard/', paths: ['data.json', 'index.html'] }])
    })

    it('leaves out empty files, directories, unsafe names and bundles over the size cap', () => {
        const groups = plan([
            { type: 'dir', name: 'x', path: `${OUT}/x`, size: 0 },
            entry('empty.txt', { size: 0 }),
            entry('huge/index.html', { size: 21 * 1024 * 1024 }),
            entry('ok.txt'),
        ])
        expect(summarize(groups)).toEqual([{ outputPath: 'ok.txt', paths: ['ok.txt'] }])
    })
})

describe('publishVmOutputArtifacts', () => {
    let db
    let bucket
    const contents = new Map()

    beforeEach(() => {
        db = new KnowledgeFirestoreDouble({
            [`projects/${PROJECT_ID}`]: { userIds: ['owner', 'teammate'] },
            [`items/${PROJECT_ID}/tasks/task-1`]: { isPublicFor: [0, 'owner'] },
            [`items/${PROJECT_ID}/tasks/private-task`]: { isPublicFor: ['owner'] },
        })
        bucket = new ArtifactBucketDouble()
        contents.clear()
    })

    const job = (objectId = 'task-1') => ({
        projectId: PROJECT_ID,
        objectType: 'tasks',
        objectId,
        requestUserId: 'owner',
        assistantId: 'assistant-1',
        correlationId: 'job-1',
    })

    const publish = (listing, objectId) =>
        publishVmOutputArtifacts({
            job: job(objectId),
            groups: plan(listing),
            readFile: async relativePath => Buffer.from(contents.get(relativePath) || ''),
            db,
            bucket,
            baseUrl: BASE_URL,
        })

    it('creates a web artifact named after its page and links it in the app', async () => {
        contents.set('dashboard/index.html', '<title>Sales Q3</title><h1>10</h1>')
        contents.set('dashboard/data.json', '{"sales":10}')

        const [published] = await publish([entry('dashboard/index.html'), entry('dashboard/data.json')])

        expect(published).toMatchObject({ created: true, versionNumber: 1, title: 'Sales Q3' })
        expect(published.url).toBe(`${BASE_URL}/projects/${PROJECT_ID}/artifacts/${published.artifactId}`)
        expect(db.read(`artifactItems/${PROJECT_ID}/artifacts/${published.artifactId}`)).toMatchObject({
            source: 'vm',
            kind: 'web',
            entryPath: 'index.html',
            fileCount: 2,
            creatorAssistantId: 'assistant-1',
            vmOutputKey: 'tasks/task-1/dashboard/',
            parentObject: { type: 'tasks', id: 'task-1', projectId: PROJECT_ID },
            isPrivate: false,
        })
    })

    it('writes version 2 of the same artifact when the next run in the thread changes it', async () => {
        contents.set('dashboard/index.html', '<title>Sales</title><h1>10</h1>')
        const [first] = await publish([entry('dashboard/index.html')])
        db.update(`artifactItems/${PROJECT_ID}/artifacts/${first.artifactId}`, { title: 'Renamed by the user' })

        contents.set('dashboard/index.html', '<title>Sales</title><h1>12</h1>')
        const [second] = await publish([entry('dashboard/index.html')])

        expect(second).toMatchObject({ artifactId: first.artifactId, versionNumber: 2, created: false })
        expect(second.title).toBe('Renamed by the user')
    })

    it('reuses identical output instead of writing another artifact version or storage copy', async () => {
        contents.set('report.pdf', '%PDF-original')
        const [first] = await publish([entry('report.pdf')])
        const filesBefore = bucket.paths()
        const [again] = await publish([entry('report.pdf')])
        expect(again).toMatchObject({
            artifactId: first.artifactId,
            versionNumber: 1,
            unchanged: true,
            outputPaths: ['report.pdf'],
        })
        expect(bucket.paths()).toEqual(filesBefore)
        expect(db.read(`artifactItems/${PROJECT_ID}/artifacts/${first.artifactId}`).versionCount).toBe(1)
    })

    it('keeps the same output path in another thread a separate artifact, private when the thread is', async () => {
        contents.set('report.md', '# Report')
        const [inPublic] = await publish([entry('report.md')], 'task-1')
        const [inPrivate] = await publish([entry('report.md')], 'private-task')

        expect(inPrivate.artifactId).not.toBe(inPublic.artifactId)
        expect(db.read(`artifactItems/${PROJECT_ID}/artifacts/${inPrivate.artifactId}`)).toMatchObject({
            isPrivate: true,
            isPublicFor: ['owner'],
        })
    })

    it('skips a group that cannot be published and still publishes the rest', async () => {
        contents.set('good.md', '# Good')
        const published = await publishVmOutputArtifacts({
            job: job(),
            groups: plan([entry('broken.md'), entry('good.md')]),
            readFile: async relativePath => {
                if (relativePath === 'broken.md') throw new Error('sandbox read failed')
                return Buffer.from(contents.get(relativePath))
            },
            db,
            bucket,
            baseUrl: BASE_URL,
        })

        expect(published.map(artifact => artifact.title)).toEqual(['good'])
    })
})

it('adds one link line per artifact under the answer', () => {
    const text = appendVmArtifactLinks('Done.', [
        { title: 'Sales Q3', versionNumber: 1, url: 'https://x/a' },
        { title: 'Report', versionNumber: 3, url: 'https://x/b' },
    ])
    expect(text).toBe('Done.\n\n📦 Sales Q3: https://x/a\n📦 Report (v3): https://x/b')
    expect(appendVmArtifactLinks('Done.', [])).toBe('Done.')
})

describe('single artifact presentation', () => {
    const { unpublishedVmFiles } = require('./vmArtifactPublisher')
    test('successful artifacts have no second chat upload, including files inside a web bundle', () => {
        const files = [
            { relativePath: 'report.pdf' },
            { relativePath: 'site/index.html' },
            { relativePath: 'site/style.css' },
            { relativePath: 'fallback.txt' },
        ]
        const published = [{ outputPaths: ['report.pdf'] }, { outputPaths: ['site/index.html', 'site/style.css'] }]
        expect(unpublishedVmFiles(files, published)).toEqual([{ relativePath: 'fallback.txt' }])
        expect(unpublishedVmFiles(files, [])).toEqual(files)
    })
    test('a link already mentioned by the VM appears once as the host artifact link', () => {
        const artifact = { title: 'Report', versionNumber: 1, url: 'https://my.alldone.app/projects/p/artifacts/a' }
        const text = appendVmArtifactLinks(
            `Done. [Report](${artifact.url})\n${artifact.url}\nVerified the figures: ${artifact.url}\nSource: https://example.com`,
            [artifact]
        )
        expect(text.match(/https:\/\/my\.alldone\.app/g)).toHaveLength(1)
        expect(text).toContain('Source: https://example.com')
        expect(text).toContain('Done.')
        expect(text).toContain('Verified the figures:')
    })
})
