jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
}))
jest.mock('firebase-admin/functions', () => ({ getFunctions: jest.fn() }), { virtual: true })
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: jest.fn(() => ({ E2B_API_KEY: 'test-key' })) }))

const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')
const vmGolden = require('./vmGolden')

// Firestore mock whose transaction returns the given project doc and records set() writes.
// `docSets` captures non-transactional doc().set() writes (e.g. touchGoldenUsage).
function mockFirestore(projectData) {
    const sets = []
    const docSets = []
    const transaction = {
        get: jest.fn(async () => ({ exists: projectData != null, data: () => projectData })),
        set: jest.fn((ref, data) => sets.push(data)),
        update: jest.fn(),
    }
    admin.firestore.mockReturnValue({
        doc: jest.fn(() => ({
            id: 'projects/p1',
            set: jest.fn(async data => {
                docSets.push(data)
            }),
        })),
        runTransaction: jest.fn(async cb => cb(transaction)),
    })
    return { sets, docSets, transaction }
}

// Firestore mock for the cleanup scan: collection('projects').where(...).get() → the given docs.
function mockFirestoreCleanup(projectDocs) {
    const get = jest.fn(async () => ({ docs: projectDocs }))
    const where = jest.fn(() => ({ get }))
    admin.firestore.mockReturnValue({ collection: jest.fn(() => ({ where })) })
    return { where }
}

function buildCleanupDoc(id, vmGolden) {
    return { id, data: () => ({ vmGolden }), ref: { set: jest.fn(async () => {}) } }
}

function mockQueue() {
    const enqueue = jest.fn(async () => {})
    getFunctions.mockReturnValue({ taskQueue: jest.fn(() => ({ enqueue })) })
    return { enqueue }
}

beforeEach(() => {
    jest.clearAllMocks()
})

describe('sanitizeGoldenName', () => {
    it('lowercases and prefixes a plain id', () => {
        expect(vmGolden.sanitizeGoldenName('ABC123')).toBe('alldone-golden-abc123')
    })
    it('replaces unsafe characters with dashes and trims', () => {
        expect(vmGolden.sanitizeGoldenName('My Proj/x!')).toBe('alldone-golden-my-proj-x')
    })
    it('falls back when the id is empty', () => {
        expect(vmGolden.sanitizeGoldenName('')).toBe('alldone-golden-project')
    })
})

describe('hashLockfileContent', () => {
    it('is deterministic and content-sensitive', () => {
        const a = vmGolden.hashLockfileContent('{"a":1}')
        expect(a).toHaveLength(64)
        expect(vmGolden.hashLockfileContent('{"a":1}')).toBe(a)
        expect(vmGolden.hashLockfileContent('{"a":2}')).not.toBe(a)
    })
})

describe('resolveGoldenTemplate', () => {
    it('returns the snapshotId when ready', () => {
        expect(vmGolden.resolveGoldenTemplate({ vmGolden: { status: 'ready', snapshotId: 'team/g:1' } })).toBe(
            'team/g:1'
        )
    })
    it('returns null when not ready or missing', () => {
        expect(vmGolden.resolveGoldenTemplate({ vmGolden: { status: 'building', snapshotId: 'team/g:1' } })).toBeNull()
        expect(vmGolden.resolveGoldenTemplate({ vmGolden: { status: 'ready' } })).toBeNull()
        expect(vmGolden.resolveGoldenTemplate({})).toBeNull()
        expect(vmGolden.resolveGoldenTemplate(null)).toBeNull()
    })
})

describe('createGoldenSnapshot', () => {
    afterEach(() => {
        delete global.fetch
    })
    it('POSTs to the snapshot endpoint and returns the snapshotID', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ snapshotID: 'team/g:2' }) }))
        const id = await vmGolden.createGoldenSnapshot('sbx-1', 'alldone-golden-p1', 'key')
        expect(id).toBe('team/g:2')
        const [url, opts] = global.fetch.mock.calls[0]
        expect(url).toBe('https://api.e2b.dev/sandboxes/sbx-1/snapshots')
        expect(opts.method).toBe('POST')
        expect(opts.headers['X-API-KEY']).toBe('key')
        expect(JSON.parse(opts.body)).toEqual({ name: 'alldone-golden-p1' })
    })
    it('throws on a non-ok response', async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }))
        await expect(vmGolden.createGoldenSnapshot('sbx-1', 'n', 'key')).rejects.toThrow(/E2B snapshot 500/)
    })
    it('throws when the response omits a snapshotID', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }))
        await expect(vmGolden.createGoldenSnapshot('sbx-1', 'n', 'key')).rejects.toThrow(/did not include a snapshotID/)
    })
})

describe('claimGoldenRebuildLease', () => {
    it('claims when idle and writes a building lease', async () => {
        const { sets } = mockFirestore({ vmGolden: { status: 'ready', snapshotId: 'team/g:1' } })
        const res = await vmGolden.claimGoldenRebuildLease('p1', 'u1', 'drift')
        expect(res.claimed).toBe(true)
        expect(res.buildId).toBeTruthy()
        expect(sets[0].vmGolden.rebuildState).toBe('building')
        expect(sets[0].vmGolden.rebuildLeaseOwner).toBe(res.buildId)
        // A pre-existing golden keeps its ready status while the new one builds.
        expect(sets[0].vmGolden.status).toBe('ready')
    })
    it('refuses when a live lease is already held', async () => {
        mockFirestore({
            vmGolden: { rebuildState: 'building', rebuildLeaseExpiresAt: Date.now() + 60000 },
        })
        const res = await vmGolden.claimGoldenRebuildLease('p1', 'u1', 'drift')
        expect(res.claimed).toBe(false)
    })
    it('claims when the prior lease has expired', async () => {
        const { sets } = mockFirestore({
            vmGolden: { rebuildState: 'building', rebuildLeaseExpiresAt: Date.now() - 1000 },
        })
        const res = await vmGolden.claimGoldenRebuildLease('p1', 'u1', 'drift')
        expect(res.claimed).toBe(true)
        expect(sets[0].vmGolden.rebuildState).toBe('building')
    })
    it('does not claim a missing project doc', async () => {
        mockFirestore(null)
        const res = await vmGolden.claimGoldenRebuildLease('p1', 'u1', 'drift')
        expect(res.claimed).toBe(false)
    })
})

describe('maybeTriggerGoldenRebuild', () => {
    it('does nothing when the golden is ready and the lockfile matches', async () => {
        const { enqueue } = mockQueue()
        mockFirestore({ vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } })
        const res = await vmGolden.maybeTriggerGoldenRebuild({
            projectId: 'p1',
            requestUserId: 'u1',
            project: { vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } },
            currentLockfileHash: 'abc',
        })
        expect(res.triggered).toBe(false)
        expect(enqueue).not.toHaveBeenCalled()
    })

    it('triggers exactly one rebuild when the lockfile drifted', async () => {
        const { enqueue } = mockQueue()
        mockFirestore({ vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } })
        const res = await vmGolden.maybeTriggerGoldenRebuild({
            projectId: 'p1',
            requestUserId: 'u1',
            project: { vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } },
            currentLockfileHash: 'xyz',
        })
        expect(res.triggered).toBe(true)
        expect(enqueue).toHaveBeenCalledTimes(1)
    })

    it('triggers a build when no golden exists yet', async () => {
        const { enqueue } = mockQueue()
        mockFirestore({ vmGolden: {} })
        const res = await vmGolden.maybeTriggerGoldenRebuild({
            projectId: 'p1',
            requestUserId: 'u1',
            project: { vmGolden: {} },
            currentLockfileHash: 'xyz',
        })
        expect(res.triggered).toBe(true)
        expect(enqueue).toHaveBeenCalledTimes(1)
    })

    it('does not trigger when a rebuild lease is already held', async () => {
        const { enqueue } = mockQueue()
        mockFirestore({ vmGolden: { rebuildState: 'building', rebuildLeaseExpiresAt: Date.now() + 60000 } })
        const res = await vmGolden.maybeTriggerGoldenRebuild({
            projectId: 'p1',
            requestUserId: 'u1',
            project: { vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } },
            currentLockfileHash: 'xyz',
        })
        expect(res.triggered).toBe(false)
        expect(enqueue).not.toHaveBeenCalled()
    })

    it('stamps lastUsedAt (not a rebuild) when the golden is fresh and used', async () => {
        mockQueue()
        const { docSets } = mockFirestore({
            vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' },
        })
        await vmGolden.maybeTriggerGoldenRebuild({
            projectId: 'p1',
            requestUserId: 'u1',
            project: { vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } },
            currentLockfileHash: 'abc',
        })
        expect(docSets.length).toBe(1)
        expect(docSets[0].vmGolden.lastUsedAt).toBeGreaterThan(0)
    })

    it('force triggers a rebuild even when the golden looks fresh', async () => {
        const { enqueue } = mockQueue()
        mockFirestore({ vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } })
        const res = await vmGolden.maybeTriggerGoldenRebuild({
            projectId: 'p1',
            requestUserId: 'u1',
            project: { vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } },
            currentLockfileHash: 'abc',
            force: true,
        })
        expect(res.triggered).toBe(true)
        expect(enqueue).toHaveBeenCalledTimes(1)
    })
})

describe('deleteGoldenSnapshot', () => {
    afterEach(() => {
        delete global.fetch
    })
    it('DELETEs the template and returns true', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, status: 200 }))
        const res = await vmGolden.deleteGoldenSnapshot('team/g:1', 'key')
        expect(res).toBe(true)
        const [url, opts] = global.fetch.mock.calls[0]
        expect(url).toBe(`https://api.e2b.dev/templates/${encodeURIComponent('team/g:1')}`)
        expect(opts.method).toBe('DELETE')
        expect(opts.headers['X-API-KEY']).toBe('key')
    })
    it('treats 404 as already gone (false, no throw)', async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
        await expect(vmGolden.deleteGoldenSnapshot('team/g:1', 'key')).resolves.toBe(false)
    })
    it('throws on other errors', async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }))
        await expect(vmGolden.deleteGoldenSnapshot('team/g:1', 'key')).rejects.toThrow(/E2B delete template 500/)
    })
})

describe('cleanupUnusedVmGoldenSnapshots', () => {
    afterEach(() => {
        delete global.fetch
    })
    it('deletes stale snapshots and resets the project pointer', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, status: 200 }))
        const stale = buildCleanupDoc('p1', { status: 'ready', snapshotId: 'team/g:1', lastUsedAt: 1 })
        mockFirestoreCleanup([stale])
        const stats = await vmGolden.cleanupUnusedVmGoldenSnapshots({ now: Date.now() })
        expect(stats.deleted).toBe(1)
        expect(stale.ref.set).toHaveBeenCalledTimes(1)
        expect(stale.ref.set.mock.calls[0][0].vmGolden.snapshotId).toBeNull()
        expect(stale.ref.set.mock.calls[0][0].vmGolden.deletedReason).toBe('unused_ttl')
    })
    it('skips a golden that is mid-rebuild', async () => {
        global.fetch = jest.fn(async () => ({ ok: true, status: 200 }))
        const building = buildCleanupDoc('p2', {
            status: 'ready',
            snapshotId: 'team/g:2',
            rebuildState: 'building',
            lastUsedAt: 1,
        })
        mockFirestoreCleanup([building])
        const stats = await vmGolden.cleanupUnusedVmGoldenSnapshots({ now: Date.now() })
        expect(stats.deleted).toBe(0)
        expect(global.fetch).not.toHaveBeenCalled()
        expect(building.ref.set).not.toHaveBeenCalled()
    })
})
