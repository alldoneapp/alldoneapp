// In-memory Firestore that persists across transactions so we can exercise the FIFO admit/advance
// sequence end-to-end (the real behavior is all about state that survives between calls).
const mockStore = {}

function mockMakeRef(path) {
    return {
        path,
        get: async () => ({ exists: mockStore[path] !== undefined, data: () => mockStore[path] || {} }),
        set: (data, opts) => {
            if (opts && opts.merge) mockStore[path] = { ...(mockStore[path] || {}), ...data }
            else mockStore[path] = { ...data }
        },
        update: data => {
            mockStore[path] = { ...(mockStore[path] || {}), ...data }
        },
        delete: () => {
            delete mockStore[path]
        },
    }
}

const mockLaunchQueuedVmJob = jest.fn(async () => ({ success: true, outcome: 'launched' }))

jest.mock(
    'firebase-admin',
    () => ({
        firestore: () => ({
            doc: path => mockMakeRef(path),
            collection: name => ({
                where: (field, op, value) => ({
                    get: async () => {
                        const docs = Object.keys(mockStore)
                            .filter(p => p.startsWith(`${name}/`))
                            .filter(p => {
                                const v = mockStore[p][field]
                                if (op === '>') return Number(v) > value
                                return true
                            })
                            .map(p => ({ id: p.slice(name.length + 1), ref: mockMakeRef(p), data: () => mockStore[p] }))
                        return { docs }
                    },
                }),
            }),
            runTransaction: async updateFn =>
                updateFn({
                    get: async ref => ref.get(),
                    set: (ref, data, options) => ref.set(data, options),
                    update: (ref, data) => ref.update(data),
                    delete: ref => ref.delete(),
                }),
        }),
    }),
    { virtual: true }
)

jest.mock('./vmJob', () => ({ launchQueuedVmJob: mockLaunchQueuedVmJob }))

const admin = require('firebase-admin')
const {
    VM_DISPATCH_LEASE_MS,
    vmThreadKey,
    admitVmJobToThread,
    isVmThreadOccupied,
    advanceVmThreadQueue,
    removeQueuedVmJobFromThread,
    requeueVmJobToThreadFront,
    blockVmThreadForInteraction,
    unblockVmThreadInteraction,
    releaseVmThreadDispatchLease,
    drainStalledVmThreadQueues,
} = require('./vmThreadQueue')

const SESSION_PATH = 'vmSessions/project-1__chat-1'
const ref = () => admin.firestore().doc(SESSION_PATH)

describe('vmThreadQueue', () => {
    beforeEach(() => {
        Object.keys(mockStore).forEach(k => delete mockStore[k])
        mockLaunchQueuedVmJob.mockClear()
        mockLaunchQueuedVmJob.mockResolvedValue({ success: true, outcome: 'launched' })
    })

    test('vmThreadKey composes projectId + objectId', () => {
        expect(vmThreadKey('p', 'o')).toBe('p__o')
    })

    test('first job on a free thread launches and takes a dispatch lease without touching status', async () => {
        // Simulate a pre-existing idle sandbox so we can prove `status` is preserved for resume.
        mockStore[SESSION_PATH] = { status: 'idle_running', sandboxId: 'sbx-1', agent: 'claude' }
        let now = 1_000_000
        const decision = await admitVmJobToThread(ref(), 'job-1', () => now)
        expect(decision).toEqual({ decision: 'launch', position: 0 })
        expect(mockStore[SESSION_PATH].activeCorrelationId).toBe('job-1')
        expect(mockStore[SESSION_PATH].activeLeaseOwner).toBe('dispatch:job-1')
        expect(mockStore[SESSION_PATH].activeLeaseExpiresAt).toBe(now + VM_DISPATCH_LEASE_MS)
        // status/sandboxId untouched → the incoming runner still resumes the idle sandbox.
        expect(mockStore[SESSION_PATH].status).toBe('idle_running')
        expect(mockStore[SESSION_PATH].sandboxId).toBe('sbx-1')
    })

    test('jobs dispatched while busy queue in FIFO order, then drain one at a time onto the same thread', async () => {
        const now = () => 2_000_000
        expect((await admitVmJobToThread(ref(), 'job-1', now)).decision).toBe('launch')
        expect(await admitVmJobToThread(ref(), 'job-2', now)).toEqual({ decision: 'queue', position: 1 })
        expect(await admitVmJobToThread(ref(), 'job-3', now)).toEqual({ decision: 'queue', position: 2 })
        expect(mockStore[SESSION_PATH].queue).toEqual(['job-2', 'job-3'])
        expect(mockStore[SESSION_PATH].queueLength).toBe(2)

        // job-1 finishes → drain hands the thread to job-2 (dispatch lease), job-3 still waiting.
        expect(await advanceVmThreadQueue(ref(), now)).toBe('job-2')
        expect(mockStore[SESSION_PATH].activeCorrelationId).toBe('job-2')
        expect(mockStore[SESSION_PATH].queue).toEqual(['job-3'])

        // job-2 finishes → job-3 runs.
        expect(await advanceVmThreadQueue(ref(), now)).toBe('job-3')
        expect(mockStore[SESSION_PATH].queue).toEqual([])

        // job-3 finishes → nothing waiting; dispatch lease released so the thread is free again.
        expect(await advanceVmThreadQueue(ref(), now)).toBeNull()
        expect(mockStore[SESSION_PATH].activeLeaseOwner).toBeNull()
        expect(mockStore[SESSION_PATH].activeCorrelationId).toBeNull()
        expect(mockStore[SESSION_PATH].queueLength).toBe(0)
    })

    test('a job whose own dispatch lease is live is not treated as "busy" (self-tolerance)', async () => {
        const now = () => 3_000_000
        await admitVmJobToThread(ref(), 'job-1', now)
        // Re-admitting the same correlationId (idempotent path) still launches, does not self-queue.
        expect((await admitVmJobToThread(ref(), 'job-1', now)).decision).toBe('launch')
        expect(mockStore[SESSION_PATH].queueLength || 0).toBe(0)
    })

    test('isVmThreadOccupied reflects a live foreign lease and a non-empty queue', async () => {
        const now = () => 4_000_000
        expect(await isVmThreadOccupied(ref(), null, now)).toBe(false)
        await admitVmJobToThread(ref(), 'job-1', now)
        // Occupied for a different job (foreign live lease)…
        expect(await isVmThreadOccupied(ref(), 'job-2', now)).toBe(true)
        // …but not for the lease owner itself.
        expect(await isVmThreadOccupied(ref(), 'job-1', now)).toBe(false)
    })

    test('an expired foreign lease with an empty queue frees the thread', async () => {
        let now = 5_000_000
        await admitVmJobToThread(ref(), 'job-1', () => now)
        now += VM_DISPATCH_LEASE_MS + 1 // lease expired, owner presumed dead
        expect(await isVmThreadOccupied(ref(), 'job-2', () => now)).toBe(false)
        expect((await admitVmJobToThread(ref(), 'job-2', () => now)).decision).toBe('launch')
    })

    test('an interaction block keeps the thread occupied without a live runtime lease', async () => {
        const now = () => 5_500_000
        await admitVmJobToThread(ref(), 'job-1', now)
        expect(await blockVmThreadForInteraction(ref(), 'job-1', 'plan_review', now)).toBe(true)
        expect(mockStore[SESSION_PATH]).toMatchObject({
            blockedByCorrelationId: 'job-1',
            blockedReason: 'plan_review',
            activeLeaseOwner: null,
        })
        expect(await isVmThreadOccupied(ref(), 'job-2', now)).toBe(true)
        expect(await admitVmJobToThread(ref(), 'job-2', now)).toEqual({ decision: 'queue', position: 1 })
        expect(await advanceVmThreadQueue(ref(), now)).toBeNull()
        expect(mockStore[SESSION_PATH].queue).toEqual(['job-2'])

        expect(await unblockVmThreadInteraction(ref(), 'other-job')).toBe(false)
        expect(await unblockVmThreadInteraction(ref(), 'job-1')).toBe(true)
        expect(await advanceVmThreadQueue(ref(), now)).toBe('job-2')
    })

    test('removeQueuedVmJobFromThread drops a cancelled job from the waiting queue', async () => {
        const now = () => 6_000_000
        await admitVmJobToThread(ref(), 'job-1', now)
        await admitVmJobToThread(ref(), 'job-2', now)
        await admitVmJobToThread(ref(), 'job-3', now)
        expect(await removeQueuedVmJobFromThread(ref(), 'job-2')).toBe(true)
        expect(mockStore[SESSION_PATH].queue).toEqual(['job-3'])
        expect(await removeQueuedVmJobFromThread(ref(), 'nope')).toBe(false)
    })

    test('requeueVmJobToThreadFront places a job ahead of existing waiters', async () => {
        const now = () => 7_000_000
        await admitVmJobToThread(ref(), 'job-1', now)
        await admitVmJobToThread(ref(), 'job-2', now)
        await requeueVmJobToThreadFront(ref(), 'job-9')
        expect(mockStore[SESSION_PATH].queue).toEqual(['job-9', 'job-2'])
        // Idempotent: re-queueing an already-present job keeps it at the front once.
        await requeueVmJobToThreadFront(ref(), 'job-2')
        expect(mockStore[SESSION_PATH].queue).toEqual(['job-2', 'job-9'])
    })

    test('releaseVmThreadDispatchLease clears only the caller’s dispatch lease', async () => {
        const now = () => 8_000_000
        await admitVmJobToThread(ref(), 'job-1', now)
        await releaseVmThreadDispatchLease(ref(), 'other-job') // not the owner → no-op
        expect(mockStore[SESSION_PATH].activeCorrelationId).toBe('job-1')
        await releaseVmThreadDispatchLease(ref(), 'job-1')
        expect(mockStore[SESSION_PATH].activeCorrelationId).toBeNull()
    })

    describe('drainStalledVmThreadQueues (crash backstop)', () => {
        test('advances + launches a thread whose owner died (expired lease, jobs waiting)', async () => {
            let now = 9_000_000
            await admitVmJobToThread(ref(), 'job-1', () => now)
            await admitVmJobToThread(ref(), 'job-2', () => now)
            now += VM_DISPATCH_LEASE_MS + 1 // owner lease expired without draining
            const result = await drainStalledVmThreadQueues(() => now)
            expect(result.advanced).toBe(1)
            expect(mockLaunchQueuedVmJob).toHaveBeenCalledWith('job-2')
            expect(mockStore[SESSION_PATH].activeCorrelationId).toBe('job-2')
        })

        test('skips a thread whose owner lease is still live', async () => {
            const now = () => 10_000_000
            await admitVmJobToThread(ref(), 'job-1', now)
            await admitVmJobToThread(ref(), 'job-2', now)
            const result = await drainStalledVmThreadQueues(now)
            expect(result.advanced).toBe(0)
            expect(mockLaunchQueuedVmJob).not.toHaveBeenCalled()
            expect(mockStore[SESSION_PATH].queue).toEqual(['job-2'])
        })

        test('does not drain a queued job past an interaction block', async () => {
            const now = () => 11_000_000
            await admitVmJobToThread(ref(), 'job-1', now)
            await admitVmJobToThread(ref(), 'job-2', now)
            await blockVmThreadForInteraction(ref(), 'job-1', 'clarification', now)
            const result = await drainStalledVmThreadQueues(now)
            expect(result.advanced).toBe(0)
            expect(mockLaunchQueuedVmJob).not.toHaveBeenCalled()
            expect(mockStore[SESSION_PATH].queue).toEqual(['job-2'])
        })
    })
})
