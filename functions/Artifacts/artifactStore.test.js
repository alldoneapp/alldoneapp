const { KnowledgeFirestoreDouble } = require('../KnowledgeBase/__fixtures__/knowledgeFirestoreDouble')
const { ArtifactBucketDouble } = require('./__fixtures__/artifactBucketDouble')
const {
    commitArtifactVersion,
    deleteArtifactData,
    resetArtifactLink,
    restoreArtifactVersion,
    rotateServeSecretOnLostReaders,
    setArtifactDataAccess,
    setArtifactPublicLink,
    withdrawPublicLinkWhenMadePrivate,
} = require('./artifactStore')

const PROJECT_ID = 'project-a'
const NOW = 1_800_000_000_000
const base64 = text => Buffer.from(text).toString('base64')

let ids
let secrets
let tokens
let db
let bucket

function newId() {
    return ids.shift()
}

function newSecret() {
    return secrets.shift()
}

function newToken() {
    return tokens.shift()
}

function artifactPath(artifactId) {
    return `artifactItems/${PROJECT_ID}/artifacts/${artifactId}`
}

function history(artifactId) {
    const prefix = `${artifactPath(artifactId)}/history/`
    return [...db.documents.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([, data]) => data)
        .sort((a, b) => a.date - b.date)
}

function commit(overrides = {}) {
    return commitArtifactVersion({
        db,
        bucket,
        now: NOW,
        newId,
        newSecret,
        newPublicToken: newToken,
        userId: 'owner',
        projectId: PROJECT_ID,
        files: [{ path: 'sales_dashboard.html', base64: base64('<h1>Sales</h1>') }],
        ...overrides,
    })
}

beforeEach(() => {
    ids = ['artifact1', 'version1', 'version2', 'version3']
    secrets = ['secret-one-aaaaaaaaaaaaaaaaaaaaaa', 'secret-two-bbbbbbbbbbbbbbbbbbbbbb']
    tokens = ['token-one-aaaaaaaaaaaa', 'token-two-bbbbbbbbbbbb', 'token-three-cccccccccc']
    db = new KnowledgeFirestoreDouble({ [`projects/${PROJECT_ID}`]: { userIds: ['owner', 'teammate'] } })
    bucket = new ArtifactBucketDouble()
})

describe('commitArtifactVersion', () => {
    it('creates an artifact with its first version, its access projection and a serve secret', async () => {
        const result = await commit()

        expect(result).toEqual({ artifactId: 'artifact1', versionId: 'version1', versionNumber: 1, created: true })
        expect(db.read(artifactPath('artifact1'))).toMatchObject({
            title: 'sales dashboard',
            kind: 'web',
            mimeType: 'text/html',
            entryPath: 'sales_dashboard.html',
            currentVersionId: 'version1',
            versionCount: 1,
            sizeBytes: 14,
            fileCount: 1,
            source: 'upload',
            serveSecret: 'secret-one-aaaaaaaaaaaaaaaaaaaaaa',
            creatorId: 'owner',
            userId: 'owner',
            lastEditionDate: NOW,
            isPrivate: false,
            isPublicFor: [0, 'owner'],
            readerIds: [0, 'owner', 'teammate'],
            followedReaderIds: ['owner'],
        })
        expect(db.read(`${artifactPath('artifact1')}/versions/version1`)).toMatchObject({
            versionNumber: 1,
            entryPath: 'sales_dashboard.html',
            files: [{ path: 'sales_dashboard.html', size: 14, mimeType: 'text/html' }],
            createdBy: 'owner',
        })
    })

    it('stores the bytes under the version without a download token', async () => {
        await commit()

        expect(bucket.paths()).toEqual([`artifacts/${PROJECT_ID}/artifact1/version1/sales_dashboard.html`])
        const stored = bucket.files.get(`artifacts/${PROJECT_ID}/artifact1/version1/sales_dashboard.html`)
        expect(stored.bytes.toString()).toBe('<h1>Sales</h1>')
        expect(JSON.stringify(stored.options)).not.toContain('firebaseStorageDownloadTokens')
    })

    it('makes a private artifact readable by its owner only', async () => {
        await commit({ isPrivate: true })

        expect(db.read(artifactPath('artifact1'))).toMatchObject({
            isPrivate: true,
            isPublicFor: ['owner'],
            readerIds: ['owner'],
        })
    })

    it('adds a version to an existing artifact and keeps its title unless a new one is given', async () => {
        await commit()
        const result = await commit({
            artifactId: 'artifact1',
            userId: 'teammate',
            files: [{ path: 'report.pdf', base64: base64('%PDF-1.7') }],
            changeSummary: 'As PDF',
        })

        expect(result).toEqual({ artifactId: 'artifact1', versionId: 'version2', versionNumber: 2, created: false })
        expect(db.read(artifactPath('artifact1'))).toMatchObject({
            title: 'sales dashboard',
            kind: 'pdf',
            entryPath: 'report.pdf',
            currentVersionId: 'version2',
            versionCount: 2,
            lastEditorId: 'teammate',
            serveSecret: 'secret-one-aaaaaaaaaaaaaaaaaaaaaa',
        })
        expect(db.read(`${artifactPath('artifact1')}/versions/version2`)).toMatchObject({
            versionNumber: 2,
            changeSummary: 'As PDF',
        })
    })

    describe('a version that only sends what changed', () => {
        const bundle = [
            { path: 'index.html', base64: base64('<h1>Dashboard</h1>') },
            { path: 'style.css', base64: base64('h1{color:red}') },
            { path: 'data.json', base64: base64('{"a":1}') },
        ]
        const stored = (versionId, path) =>
            bucket.files.get(`artifacts/${PROJECT_ID}/artifact1/${versionId}/${path}`)?.bytes.toString()

        it('copies the unchanged files, replaces and removes the named ones and keeps the entry file', async () => {
            await commit({ files: bundle })
            const result = await commit({
                artifactId: 'artifact1',
                keepUnchangedFiles: true,
                files: [{ path: 'style.css', base64: base64('h1{color:blue}') }],
                removePaths: ['data.json'],
                assistantId: 'assistant-1',
            })

            expect(result).toMatchObject({ versionId: 'version2', versionNumber: 2 })
            expect(stored('version2', 'index.html')).toBe('<h1>Dashboard</h1>')
            expect(stored('version2', 'style.css')).toBe('h1{color:blue}')
            expect(stored('version2', 'data.json')).toBeUndefined()
            expect(stored('version1', 'style.css')).toBe('h1{color:red}')
            const version = db.read(`${artifactPath('artifact1')}/versions/version2`)
            expect(version.files.map(file => file.path).sort()).toEqual(['index.html', 'style.css'])
            expect(version).toMatchObject({ entryPath: 'index.html', assistantId: 'assistant-1' })
            expect(db.read(artifactPath('artifact1'))).toMatchObject({ fileCount: 2, entryPath: 'index.html' })
        })

        it('refuses to remove a file the artifact does not have, or to leave it empty', async () => {
            await commit({ files: bundle })
            await expect(
                commit({ artifactId: 'artifact1', keepUnchangedFiles: true, files: [], removePaths: ['nope.js'] })
            ).rejects.toMatchObject({ code: 'invalid-argument' })
            await expect(
                commit({
                    artifactId: 'artifact1',
                    keepUnchangedFiles: true,
                    files: [],
                    removePaths: ['index.html', 'style.css', 'data.json'],
                })
            ).rejects.toMatchObject({ code: 'invalid-argument' })
        })

        it('fails instead of dropping a version that was written meanwhile, and cleans up its files', async () => {
            await commit({ files: bundle })
            bucket.beforeWrite = async () => {
                bucket.beforeWrite = null
                db.update(artifactPath('artifact1'), { currentVersionId: 'someone-elses-version' })
            }

            await expect(
                commit({
                    artifactId: 'artifact1',
                    keepUnchangedFiles: true,
                    files: [{ path: 'style.css', base64: base64('x') }],
                })
            ).rejects.toMatchObject({ code: 'aborted' })
            expect(bucket.paths().filter(path => path.includes('/version2/'))).toEqual([])
        })
    })

    it('records which assistant created an artifact', async () => {
        await commit({ source: 'assistant', assistantId: 'assistant-1' })
        expect(db.read(artifactPath('artifact1'))).toMatchObject({
            source: 'assistant',
            creatorAssistantId: 'assistant-1',
            assistantId: 'assistant-1',
        })
    })

    it('lands a multi-file version on its index.html', async () => {
        await commit({
            files: [
                { path: 'assets/app.js', base64: base64('console.log(1)') },
                { path: 'index.html', base64: base64('<script src="assets/app.js"></script>') },
            ],
            title: 'Dashboard',
        })

        expect(db.read(artifactPath('artifact1'))).toMatchObject({
            title: 'Dashboard',
            entryPath: 'index.html',
            fileCount: 2,
        })
    })

    it('refuses anybody outside the project', async () => {
        await expect(commit({ userId: 'outsider' })).rejects.toMatchObject({ code: 'permission-denied' })
        expect(bucket.paths()).toEqual([])
    })

    it('reports a private artifact as missing to a member who cannot read it', async () => {
        await commit({ isPrivate: true })
        await expect(
            commit({ artifactId: 'artifact1', userId: 'teammate', files: [{ path: 'x.txt', base64: base64('x') }] })
        ).rejects.toMatchObject({ code: 'not-found' })
    })

    it.each([
        ['no files', []],
        ['a traversal path', [{ path: '../escape.html', base64: base64('x') }]],
        [
            'a file twice',
            [
                { path: 'a.txt', base64: base64('1') },
                { path: '/a.txt', base64: base64('2') },
            ],
        ],
        ['a file without content', [{ path: 'a.txt' }]],
    ])('refuses %s before storing anything', async (_label, files) => {
        await expect(commit({ files })).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(bucket.paths()).toEqual([])
    })

    it('refuses an upload over 20 MB', async () => {
        const tooLarge = Buffer.alloc(20 * 1024 * 1024 + 1).toString('base64')
        await expect(commit({ files: [{ path: 'big.bin', base64: tooLarge }] })).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })

    it('removes the stored files again when the version cannot be saved', async () => {
        db.runTransaction = async () => {
            throw new Error('contention')
        }
        await expect(commit()).rejects.toThrow('contention')
        expect(bucket.paths()).toEqual([])
    })
})

describe('restoreArtifactVersion', () => {
    it('points the artifact back at an earlier version', async () => {
        await commit()
        await commit({ artifactId: 'artifact1', files: [{ path: 'report.pdf', base64: base64('%PDF') }] })

        await restoreArtifactVersion({
            db,
            now: NOW + 5,
            userId: 'teammate',
            projectId: PROJECT_ID,
            artifactId: 'artifact1',
            versionId: 'version1',
        })

        expect(db.read(artifactPath('artifact1'))).toMatchObject({
            currentVersionId: 'version1',
            kind: 'web',
            entryPath: 'sales_dashboard.html',
            versionCount: 2,
            lastEditorId: 'teammate',
            lastEditionDate: NOW + 5,
        })
    })

    it('refuses a version that does not exist', async () => {
        await commit()
        await expect(
            restoreArtifactVersion({
                db,
                userId: 'owner',
                projectId: PROJECT_ID,
                artifactId: 'artifact1',
                versionId: 'nope',
            })
        ).rejects.toMatchObject({ code: 'not-found' })
    })
})

describe('serve secret', () => {
    it('is replaced by "Reset link"', async () => {
        await commit()
        await resetArtifactLink({ db, newSecret, userId: 'teammate', projectId: PROJECT_ID, artifactId: 'artifact1' })
        expect(db.read(artifactPath('artifact1')).serveSecret).toBe('secret-two-bbbbbbbbbbbbbbbbbbbbbb')
    })

    it('cannot be reset by a member who cannot read the artifact', async () => {
        await commit({ isPrivate: true })
        await expect(
            resetArtifactLink({ db, newSecret, userId: 'teammate', projectId: PROJECT_ID, artifactId: 'artifact1' })
        ).rejects.toMatchObject({ code: 'not-found' })
    })

    it('rotates when somebody loses read access, and only then', async () => {
        await commit()
        const before = db.read(artifactPath('artifact1'))
        const rotate = after =>
            rotateServeSecretOnLostReaders({
                db,
                newSecret,
                projectId: PROJECT_ID,
                artifactId: 'artifact1',
                before,
                after,
            })

        await expect(rotate({ ...before, readerIds: [0, 'owner', 'teammate', 'newcomer'] })).resolves.toBe(false)
        await expect(
            rotate({ ...before, serveSecret: 'already-new-cccccccccccccccc', readerIds: ['owner'] })
        ).resolves.toBe(false)
        await expect(rotate({ ...before, readerIds: ['owner'] })).resolves.toBe(true)
        expect(db.read(artifactPath('artifact1')).serveSecret).toBe('secret-two-bbbbbbbbbbbbbbbbbbbbbb')
    })
})

describe('public link', () => {
    const linkPath = token => `artifactPublicLinks/${token}`
    const setLink = (action, overrides = {}) =>
        setArtifactPublicLink({
            db,
            now: NOW + 1000,
            newToken,
            userId: 'teammate',
            projectId: PROJECT_ID,
            artifactId: 'artifact1',
            action,
            ...overrides,
        })

    it('is on for a new artifact, with a lookup that leads back to it', async () => {
        await commit()
        expect(db.read(artifactPath('artifact1')).publicLink).toEqual({
            token: 'token-one-aaaaaaaaaaaa',
            createdAt: NOW,
            createdBy: 'owner',
        })
        expect(db.read(linkPath('token-one-aaaaaaaaaaaa'))).toEqual({
            projectId: PROJECT_ID,
            artifactId: 'artifact1',
            created: NOW,
        })
    })

    it('is off for a private artifact, and a new version does not change it', async () => {
        await commit({ isPrivate: true })
        expect(db.read(artifactPath('artifact1')).publicLink).toBeNull()
        expect(tokens).toHaveLength(3)

        await commit({ artifactId: 'artifact1', files: [{ path: 'report.pdf', base64: base64('%PDF') }] })
        expect(db.read(artifactPath('artifact1')).publicLink).toBeNull()
    })

    it('is changed to a new address that replaces the old one', async () => {
        await commit()
        const result = await setLink('change')

        expect(result).toEqual({
            artifactId: 'artifact1',
            changed: true,
            publicLink: { token: 'token-two-bbbbbbbbbbbb', createdAt: NOW + 1000, createdBy: 'teammate' },
        })
        expect(db.read(artifactPath('artifact1')).publicLink.token).toBe('token-two-bbbbbbbbbbbb')
        expect(db.read(linkPath('token-one-aaaaaaaaaaaa'))).toBeUndefined()
        expect(db.read(linkPath('token-two-bbbbbbbbbbbb'))).toMatchObject({ artifactId: 'artifact1' })
        // The preview's address is a different secret and stays as it was.
        expect(db.read(artifactPath('artifact1')).serveSecret).toBe('secret-one-aaaaaaaaaaaaaaaaaaaaaa')
    })

    it('is switched off and on again, and on again means a new address', async () => {
        await commit()
        await expect(setLink('disable')).resolves.toMatchObject({ changed: true, publicLink: null })
        expect(db.read(artifactPath('artifact1')).publicLink).toBeNull()
        expect(db.read(linkPath('token-one-aaaaaaaaaaaa'))).toBeUndefined()
        await expect(setLink('disable')).resolves.toMatchObject({ changed: false, publicLink: null })

        await setLink('enable')
        expect(db.read(artifactPath('artifact1')).publicLink.token).toBe('token-two-bbbbbbbbbbbb')
        await expect(setLink('enable')).resolves.toMatchObject({ changed: false })
        expect(db.read(artifactPath('artifact1')).publicLink.token).toBe('token-two-bbbbbbbbbbbb')
    })

    it('records who switched it in the history', async () => {
        await commit()
        await setLink('change')
        await setLink('disable', { now: NOW + 2000 })
        await setLink('enable', { now: NOW + 3000, userId: 'owner' })
        expect(history('artifact1').map(({ type, actorId }) => [type, actorId])).toEqual([
            ['created', 'owner'],
            ['public_link_changed', 'teammate'],
            ['public_link_off', 'teammate'],
            ['public_link_on', 'owner'],
        ])
    })

    it('can only be switched by somebody who can read the artifact, and only with a known action', async () => {
        await commit({ isPrivate: true })
        await expect(setLink('enable')).rejects.toMatchObject({ code: 'not-found' })
        await expect(setLink('enable', { userId: 'stranger' })).rejects.toMatchObject({ code: 'permission-denied' })
        await expect(setLink('publish', { userId: 'owner' })).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('ends when the artifact is made private, and only then', async () => {
        await commit()
        const before = db.read(artifactPath('artifact1'))
        const withdraw = after =>
            withdrawPublicLinkWhenMadePrivate({
                db,
                now: NOW + 5000,
                projectId: PROJECT_ID,
                artifactId: 'artifact1',
                before,
                after,
            })

        await expect(withdraw({ ...before, title: 'Renamed' })).resolves.toBe(false)
        db.documents.set(artifactPath('artifact1'), { ...before, isPrivate: true })
        await expect(withdraw({ ...before, isPrivate: true })).resolves.toBe(true)
        expect(db.read(artifactPath('artifact1')).publicLink).toBeNull()
        expect(db.read(linkPath('token-one-aaaaaaaaaaaa'))).toBeUndefined()
        expect(history('artifact1').pop()).toMatchObject({ type: 'public_link_withdrawn', actorId: '' })
    })

    it('stays when the artifact turned private and back before the trigger ran', async () => {
        await commit()
        const before = db.read(artifactPath('artifact1'))
        await expect(
            withdrawPublicLinkWhenMadePrivate({
                db,
                projectId: PROJECT_ID,
                artifactId: 'artifact1',
                before,
                after: { ...before, isPrivate: true },
            })
        ).resolves.toBe(false)
        expect(db.read(artifactPath('artifact1')).publicLink.token).toBe('token-one-aaaaaaaaaaaa')
    })

    it('goes with a deleted artifact', async () => {
        await commit()
        const { publicLink } = db.read(artifactPath('artifact1'))
        await deleteArtifactData({ db, bucket, projectId: PROJECT_ID, artifactId: 'artifact1', publicLink })
        expect(db.read(linkPath('token-one-aaaaaaaaaaaa'))).toBeUndefined()
    })
})

it('deletes every version and every stored file of a deleted artifact', async () => {
    await commit()
    await commit({ artifactId: 'artifact1', files: [{ path: 'report.pdf', base64: base64('%PDF') }] })
    await bucket.file(`artifacts/${PROJECT_ID}/other/version9/keep.txt`).save('keep')

    await deleteArtifactData({ db, bucket, projectId: PROJECT_ID, artifactId: 'artifact1' })

    expect(db.read(`${artifactPath('artifact1')}/versions/version1`)).toBeUndefined()
    expect(db.read(`${artifactPath('artifact1')}/versions/version2`)).toBeUndefined()
    expect(bucket.paths()).toEqual([`artifacts/${PROJECT_ID}/other/version9/keep.txt`])
})

describe('history', () => {
    it('records the creation and every version with who saved it and how', async () => {
        await commit({ source: 'assistant', assistantId: 'assistant-1' })
        await commit({
            artifactId: 'artifact1',
            now: NOW + 1,
            changeSummary: 'Adds Q3',
            files: [{ path: 'report.pdf', base64: base64('%PDF') }],
        })

        expect(history('artifact1')).toEqual([
            expect.objectContaining({
                type: 'created',
                actorId: 'owner',
                assistantId: 'assistant-1',
                versionId: 'version1',
                versionNumber: 1,
                source: 'assistant',
            }),
            expect.objectContaining({
                type: 'version',
                actorId: 'owner',
                versionId: 'version2',
                versionNumber: 2,
                changeSummary: 'Adds Q3',
            }),
        ])
    })

    it('records a restore, a reset link and a link that stopped working on its own', async () => {
        await commit()
        await commit({ artifactId: 'artifact1', files: [{ path: 'report.pdf', base64: base64('%PDF') }] })
        await restoreArtifactVersion({
            db,
            now: NOW + 5,
            userId: 'teammate',
            projectId: PROJECT_ID,
            artifactId: 'artifact1',
            versionId: 'version1',
        })
        await resetArtifactLink({
            db,
            now: NOW + 6,
            newSecret,
            userId: 'teammate',
            projectId: PROJECT_ID,
            artifactId: 'artifact1',
        })
        const before = db.read(artifactPath('artifact1'))
        secrets.push('secret-three-cccccccccccccccccccc')
        await rotateServeSecretOnLostReaders({
            db,
            now: NOW + 7,
            newSecret,
            projectId: PROJECT_ID,
            artifactId: 'artifact1',
            before,
            after: { ...before, readerIds: ['owner'] },
        })

        expect(history('artifact1').slice(2)).toEqual([
            expect.objectContaining({ type: 'restored', actorId: 'teammate', versionId: 'version1', versionNumber: 1 }),
            expect.objectContaining({ type: 'link_reset', actorId: 'teammate' }),
            expect.objectContaining({ type: 'link_rotated', actorId: '' }),
        ])
    })

    it('goes with the artifact', async () => {
        await commit()
        await deleteArtifactData({ db, bucket, projectId: PROJECT_ID, artifactId: 'artifact1' })
        expect(history('artifact1')).toEqual([])
    })
})

describe('live project data', () => {
    const toggle = (userId, enabled) =>
        setArtifactDataAccess({ db, now: NOW + 9, userId, projectId: PROJECT_ID, artifactId: 'artifact1', enabled })

    it('is off unless asked for, and can be asked for on creation', async () => {
        await commit()
        expect(db.read(artifactPath('artifact1')).dataAccess).toBe(false)
        ids = ['artifact2', 'version9']
        await commit({ dataAccess: true })
        expect(db.read(artifactPath('artifact2')).dataAccess).toBe(true)
    })

    it('is switched by the owner only, and the switch is in the history', async () => {
        await commit()
        await expect(toggle('teammate', true)).rejects.toMatchObject({ code: 'permission-denied' })
        await expect(toggle('owner', 'yes')).rejects.toMatchObject({ code: 'invalid-argument' })

        await expect(toggle('owner', true)).resolves.toEqual({
            artifactId: 'artifact1',
            dataAccess: true,
            changed: true,
        })
        await expect(toggle('owner', true)).resolves.toMatchObject({ changed: false })
        expect(db.read(artifactPath('artifact1')).dataAccess).toBe(true)
        expect(history('artifact1').map(event => event.type)).toEqual(['created', 'data_access_on'])
    })

    it('can be changed with a new version by the owner, never by someone else', async () => {
        await commit()
        await expect(
            commit({
                artifactId: 'artifact1',
                userId: 'teammate',
                dataAccess: true,
                files: [{ path: 'x.html', base64: base64('x') }],
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        await commit({ artifactId: 'artifact1', dataAccess: true, files: [{ path: 'x.html', base64: base64('x') }] })
        expect(db.read(artifactPath('artifact1')).dataAccess).toBe(true)
    })
})
