const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const { ArtifactBucketDouble } = require('./__fixtures__/artifactBucketDouble')
const { executeArtifactTool, resolveArtifactDraftAttachments } = require('./artifactAssistant')
const { commitArtifactVersion } = require('./artifactStore')

const PROJECT_ID = 'project-a'
const BASE_URL = 'https://my.alldone.app'

let db
let bucket

function run(toolName, args, { userId = 'owner', runtime = {}, assistantId = 'assistant-1' } = {}) {
    return executeArtifactTool({
        toolName,
        args,
        projectId: PROJECT_ID,
        requestUserId: userId,
        assistantId,
        toolRuntimeContext: { projectId: PROJECT_ID, ...runtime },
        db,
        bucket,
        baseUrl: BASE_URL,
    })
}

const dashboard = {
    title: 'Sales dashboard',
    files: [
        { path: 'index.html', content: '<link rel="stylesheet" href="style.css"><h1>Sales: 10</h1>' },
        { path: 'style.css', content: 'h1 { color: red }' },
    ],
}

beforeEach(() => {
    db = new KnowledgeFirestoreDouble({
        [`projects/${PROJECT_ID}`]: { userIds: ['owner', 'teammate'] },
        [`items/${PROJECT_ID}/tasks/public-task`]: { isPublicFor: [0, 'owner'] },
        [`items/${PROJECT_ID}/tasks/private-task`]: { isPrivate: true, isPublicFor: ['owner'] },
    })
    bucket = new ArtifactBucketDouble()
})

describe('artifact attachments for email drafts', () => {
    const resolve = (attachments, userId = 'owner') =>
        resolveArtifactDraftAttachments({ attachments, userId, projectId: PROJECT_ID, db, bucket })
    const pdf = Buffer.from('%PDF-1.7\noriginal binary\x00\xff', 'binary')
    const createPdf = options =>
        commitArtifactVersion({
            db,
            bucket,
            projectId: PROJECT_ID,
            userId: 'owner',
            files: [{ path: 'letter.pdf', base64: pdf.toString('base64') }],
            ...options,
        })

    it('attaches the original bytes of the specified version, even after an update', async () => {
        const { artifactId } = await createPdf()
        await createPdf({
            artifactId,
            files: [{ path: 'letter.pdf', base64: Buffer.from('new version').toString('base64') }],
        })
        const result = await resolve([{ artifactId, versionNumber: 1 }])
        expect(result).toEqual([
            { fileName: 'letter.pdf', mimeType: 'application/pdf', base64: pdf.toString('base64') },
        ])
        expect(Buffer.from(result[0].base64, 'base64')).toEqual(pdf)
        const info = await run('read_artifact', { artifactId, versionNumber: 1 })
        expect(info).toMatchObject({
            content: null,
            attachment: { artifactId, projectId: PROJECT_ID, versionNumber: 1, path: 'letter.pdf' },
        })
        expect(await resolve([info.attachment])).toEqual(result)
    })

    it('rejects private and foreign project files before downloading', async () => {
        const { artifactId } = await createPdf({ isPrivate: true })
        const before = jest.spyOn(bucket, 'file')
        await expect(resolve([{ artifactId }], 'teammate')).rejects.toThrow('Artifact not found')
        await expect(resolve([{ artifactId, projectId: 'foreign' }])).rejects.toThrow('member')
        expect(before).not.toHaveBeenCalled()
    })

    it('rejects unknown paths, traversal and ambiguous binary sources', async () => {
        const { artifactId } = await createPdf()
        await expect(resolve([{ artifactId, path: 'missing.pdf' }])).rejects.toThrow('not part')
        await expect(resolve([{ artifactId, path: '../private.pdf' }])).rejects.toThrow()
        await expect(resolve([{ artifactId, base64: 'YWJj' }])).rejects.toThrow('not both')
    })

    it('rejects oversized storage files before downloading', async () => {
        const { artifactId } = await createPdf()
        const originalFile = bucket.file.bind(bucket)
        const download = jest.fn()
        jest.spyOn(bucket, 'file').mockImplementation(path => ({
            ...originalFile(path),
            getMetadata: async () => [{ size: String(10 * 1024 * 1024 + 1) }],
            download,
        }))
        await expect(resolve([{ artifactId }])).rejects.toThrow('10 MB')
        expect(download).not.toHaveBeenCalled()
    })

    it('keeps existing base64 attachments intact in a mixed list', async () => {
        const { artifactId } = await createPdf()
        const existing = { fileName: 'note.txt', base64: 'YWJj' }
        expect((await resolve([existing, { artifactId }]))[0]).toEqual(existing)
    })
})

describe('create_artifact', () => {
    it('stores the files as an assistant artifact and returns the in-app link, never the serve secret', async () => {
        const result = await run('create_artifact', dashboard)

        expect(result).toMatchObject({
            success: true,
            title: 'Sales dashboard',
            kind: 'web',
            entryPath: 'index.html',
            versionNumber: 1,
            isPrivate: false,
            url: `${BASE_URL}/projects/${PROJECT_ID}/artifacts/${result.artifactId}`,
        })
        expect(JSON.stringify(result)).not.toContain(
            db.read(`artifactItems/${PROJECT_ID}/artifacts/${result.artifactId}`).serveSecret
        )
        expect(db.read(`artifactItems/${PROJECT_ID}/artifacts/${result.artifactId}`)).toMatchObject({
            source: 'assistant',
            creatorAssistantId: 'assistant-1',
            userId: 'owner',
            readerIds: expect.arrayContaining(['owner', 'teammate']),
        })
    })

    it('inherits the privacy of the thread it was made in, and records that thread', async () => {
        const fromPublic = await run('create_artifact', dashboard, {
            runtime: { objectType: 'tasks', objectId: 'public-task' },
        })
        const fromPrivate = await run('create_artifact', dashboard, {
            runtime: { objectType: 'tasks', objectId: 'private-task' },
        })
        const fromUnknown = await run('create_artifact', dashboard, {
            runtime: { objectType: 'tasks', objectId: 'missing-task' },
        })

        expect(fromPublic.isPrivate).toBe(false)
        expect(fromPrivate.isPrivate).toBe(true)
        expect(fromUnknown.isPrivate).toBe(true)
        expect(db.read(`artifactItems/${PROJECT_ID}/artifacts/${fromPrivate.artifactId}`)).toMatchObject({
            isPublicFor: ['owner'],
            parentObject: { type: 'tasks', id: 'private-task', projectId: PROJECT_ID },
        })
    })

    it('returns input mistakes to the model instead of throwing', async () => {
        await expect(run('create_artifact', { title: 'x', files: [] })).resolves.toMatchObject({ success: false })
        await expect(
            run('create_artifact', { title: 'x', files: [{ path: '../escape.html', content: 'x' }] })
        ).resolves.toMatchObject({ success: false })
        await expect(run('create_artifact', dashboard, { userId: 'outsider' })).resolves.toMatchObject({
            success: false,
        })
    })
})

describe('read_artifact and get_artifacts', () => {
    it('reads the entry file, a named file and lists the files', async () => {
        const { artifactId } = await run('create_artifact', dashboard)

        const entry = await run('read_artifact', { artifactId })
        expect(entry).toMatchObject({ path: 'index.html', content: dashboard.files[0].content, truncated: false })
        expect(entry.files.map(file => file.path).sort()).toEqual(['index.html', 'style.css'])

        const css = await run('read_artifact', { artifactId, path: 'style.css' })
        expect(css.content).toBe('h1 { color: red }')
    })

    it('hides a private artifact from a teammate, in reads and in the list', async () => {
        const { artifactId } = await run('create_artifact', { ...dashboard, isPrivate: true })
        const visible = await run('create_artifact', { ...dashboard, title: 'Team report' })

        await expect(run('read_artifact', { artifactId }, { userId: 'teammate' })).resolves.toEqual({
            success: false,
            error: 'Artifact not found.',
        })
        const list = await run('get_artifacts', {}, { userId: 'teammate' })
        expect(list.artifacts.map(artifact => artifact.artifactId)).toEqual([visible.artifactId])
        const filtered = await run('get_artifacts', { query: 'sales' })
        expect(filtered.artifacts.map(artifact => artifact.title)).toEqual(['Sales dashboard'])
    })
})

describe('update_artifact', () => {
    it('applies exact edits, keeps the other files and makes the old version readable', async () => {
        const { artifactId } = await run('create_artifact', dashboard)

        const result = await run('update_artifact', {
            artifactId,
            edits: [{ path: 'index.html', find: 'Sales: 10', replace: 'Sales: 12' }],
            changeSummary: 'New numbers',
        })

        expect(result).toMatchObject({ success: true, versionNumber: 2, changedFiles: ['index.html'] })
        const current = await run('read_artifact', { artifactId })
        expect(current.content).toContain('Sales: 12')
        expect(current.files.map(file => file.path).sort()).toEqual(['index.html', 'style.css'])
        expect((await run('read_artifact', { artifactId, path: 'style.css' })).content).toBe('h1 { color: red }')
        expect((await run('read_artifact', { artifactId, versionNumber: 1 })).content).toContain('Sales: 10')
    })

    it('adds, replaces and removes files', async () => {
        const { artifactId } = await run('create_artifact', dashboard)

        await run('update_artifact', {
            artifactId,
            files: [{ path: 'data.json', content: '{"sales":12}' }],
            removePaths: ['style.css'],
        })

        const current = await run('read_artifact', { artifactId })
        expect(current.files.map(file => file.path).sort()).toEqual(['data.json', 'index.html'])
        expect(current.path).toBe('index.html')
    })

    it('refuses an edit whose text is missing or ambiguous, and writes nothing', async () => {
        const { artifactId } = await run('create_artifact', {
            title: 'Twice',
            files: [{ path: 'index.html', content: '<p>a</p><p>a</p>' }],
        })

        await expect(
            run('update_artifact', { artifactId, edits: [{ path: 'index.html', find: 'nope', replace: 'x' }] })
        ).resolves.toMatchObject({ success: false, error: expect.stringContaining('not found') })
        await expect(
            run('update_artifact', { artifactId, edits: [{ path: 'index.html', find: '<p>a</p>', replace: 'x' }] })
        ).resolves.toMatchObject({ success: false, error: expect.stringContaining('2 times') })
        expect(db.read(`artifactItems/${PROJECT_ID}/artifacts/${artifactId}`).versionCount).toBe(1)
    })

    it('changes the title without writing a version', async () => {
        const { artifactId } = await run('create_artifact', dashboard)

        const result = await run('update_artifact', { artifactId, title: 'Q3 sales' })

        expect(result).toMatchObject({ success: true, title: 'Q3 sales', versionNumber: 1 })
    })

    it('switches live project data for the owner, alone or with a version, and refuses anyone else', async () => {
        const { artifactId, liveData } = await run('create_artifact', { ...dashboard, liveData: true })
        expect(liveData).toBe(true)

        await expect(run('update_artifact', { artifactId, liveData: false }, { userId: 'teammate' })).resolves.toEqual({
            success: false,
            error: "Only the artifact's owner can switch live project data on or off.",
        })
        await expect(run('update_artifact', { artifactId, liveData: false })).resolves.toMatchObject({
            success: true,
            liveData: false,
            versionNumber: 1,
        })
    })

    it('cannot touch an artifact the requesting user cannot see', async () => {
        const { artifactId } = await run('create_artifact', { ...dashboard, isPrivate: true })

        await expect(
            run('update_artifact', { artifactId, title: 'Mine now' }, { userId: 'teammate' })
        ).resolves.toEqual({ success: false, error: 'Artifact not found.' })
        expect(db.read(`artifactItems/${PROJECT_ID}/artifacts/${artifactId}`).title).toBe('Sales dashboard')
    })
})

describe('over MCP', () => {
    // An MCP client acts in the user's name; the history says which client it was (shared/mcpActor.js).
    const mcp = { assistantId: null, runtime: { sourceChannel: 'mcp', mcpClient: 'Claude' } }
    const artifactPath = artifactId => `artifactItems/${PROJECT_ID}/artifacts/${artifactId}`
    const historyEvents = artifactId =>
        [...db.documents.keys()]
            .filter(path => path.startsWith(`${artifactPath(artifactId)}/history/`))
            .map(path => db.read(path))

    it('labels the versions it saves with the client, in the version and in the history', async () => {
        const { artifactId } = await run('create_artifact', dashboard, mcp)
        const versionId = db.read(artifactPath(artifactId)).currentVersionId
        expect(db.read(`${artifactPath(artifactId)}/versions/${versionId}`)).toMatchObject({
            createdBy: 'owner',
            via: 'mcp',
            viaClient: 'Claude',
        })

        await run(
            'update_artifact',
            { artifactId, edits: [{ path: 'index.html', find: 'Sales: 10', replace: 'Sales: 12' }] },
            mcp
        )

        expect(
            historyEvents(artifactId).map(({ type, actorId, via, viaClient }) => ({ type, actorId, via, viaClient }))
        ).toEqual(
            expect.arrayContaining([
                { type: 'created', actorId: 'owner', via: 'mcp', viaClient: 'Claude' },
                { type: 'version', actorId: 'owner', via: 'mcp', viaClient: 'Claude' },
            ])
        )
        const artifact = db.read(artifactPath(artifactId))
        expect(artifact.lastEditorVia).toEqual({
            via: 'mcp',
            viaClient: 'Claude',
            editionDate: artifact.lastEditionDate,
        })
    })

    it('stamps a rename so the trigger can label it, and labels the live data switch', async () => {
        const { artifactId } = await run('create_artifact', { ...dashboard, liveData: true }, mcp)

        await run('update_artifact', { artifactId, title: 'Q3 sales' }, mcp)
        const renamed = db.read(artifactPath(artifactId))
        expect(renamed.lastEditorVia).toEqual({ via: 'mcp', viaClient: 'Claude', editionDate: renamed.lastEditionDate })

        await run('update_artifact', { artifactId, liveData: false }, mcp)
        expect(historyEvents(artifactId).find(event => event.type === 'data_access_off')).toMatchObject({
            actorId: 'owner',
            via: 'mcp',
            viaClient: 'Claude',
        })
    })

    it('leaves what an assistant does in the app unlabelled', async () => {
        const { artifactId } = await run('create_artifact', dashboard)
        const versionId = db.read(artifactPath(artifactId)).currentVersionId
        await run('update_artifact', { artifactId, title: 'Q3 sales' })

        expect(db.read(`${artifactPath(artifactId)}/versions/${versionId}`)).not.toHaveProperty('via')
        expect(historyEvents(artifactId).every(event => !('via' in event))).toBe(true)
        expect(db.read(artifactPath(artifactId)).lastEditorVia).toBeFalsy()
    })
})
