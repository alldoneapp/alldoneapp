const docs = new Map()

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function write(path, data, options = {}) {
    docs.set(path, options.merge ? { ...(docs.get(path) || {}), ...clone(data) } : clone(data))
}

function mockDocRef(path) {
    return {
        id: path.split('/').pop(),
        path,
        get: jest.fn(async () => ({
            exists: docs.has(path),
            data: () => clone(docs.get(path) || {}),
        })),
        set: jest.fn(async (data, options) => write(path, data, options)),
        update: jest.fn(async data => write(path, data, { merge: true })),
    }
}

function mockCollectionRef(path) {
    const filters = []
    const query = {
        where: jest.fn((field, operator, value) => {
            filters.push({ field, operator, value })
            return query
        }),
        limit: jest.fn(() => query),
        get: jest.fn(async () => ({
            docs: Array.from(docs.entries())
                .filter(([docPath]) => docPath.startsWith(`${path}/`) && docPath.split('/').length === 2)
                .filter(([, data]) =>
                    filters.every(filter => filter.operator === '==' && data[filter.field] === filter.value)
                )
                .map(([docPath, data]) => ({
                    id: docPath.split('/').pop(),
                    ref: mockDocRef(docPath),
                    data: () => clone(data),
                })),
        })),
    }
    return query
}

const mockFirestore = {
    doc: jest.fn(mockDocRef),
    collection: jest.fn(mockCollectionRef),
    runTransaction: jest.fn(async callback =>
        callback({
            get: jest.fn(async ref => ref.get()),
            set: jest.fn((ref, data, options) => write(ref.path, data, options)),
            update: jest.fn((ref, data) => write(ref.path, data, { merge: true })),
        })
    ),
}

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => mockFirestore),
}))

jest.mock('firebase-admin/firestore', () => ({
    Timestamp: { now: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

const mockFindExecution = jest.fn()
const mockGetExecution = jest.fn(async () => null)
jest.mock('./vmCloudRunLauncher', () => ({
    findVmCloudRunExecution: (...args) => mockFindExecution(...args),
    getVmCloudRunExecution: (...args) => mockGetExecution(...args),
    __private__: {
        classifyVmCloudRunExecution: execution =>
            execution?.cancelledCount
                ? { terminal: true, outcome: 'cancelled', message: 'Cancelled.' }
                : execution?.completionTime
                  ? { terminal: true, outcome: 'failed', reason: 'NON_ZERO_EXIT_CODE', message: 'Container exited.' }
                  : { terminal: false, outcome: 'running', message: '' },
        executionHasCorrelationId: (execution, correlationId) => execution?.correlationId === correlationId,
        executionHasAttemptId: (execution, attemptId) => !attemptId || execution?.attemptId === attemptId,
    },
}))

const mockAdvanceQueue = jest.fn(async () => null)
jest.mock('./vmThreadQueue', () => ({
    vmThreadSessionRef: (projectId, objectId) => mockDocRef(`vmSessions/${projectId}__${objectId}`),
    advanceVmThreadQueue: (...args) => mockAdvanceQueue(...args),
}))

const mockApplyFailureHold = jest.fn(async () => true)
jest.mock('./vmWorkflowHold', () => ({
    applyVmFailureWorkflowHold: (...args) => mockApplyFailureHold(...args),
}))

const mockRefundGold = jest.fn(async () => ({ success: true }))
jest.mock('../Gold/goldHelper', () => ({
    refundGold: (...args) => mockRefundGold(...args),
}))

const mockWriteStatusComment = jest.fn(async () => true)
const mockNotifyResultChannels = jest.fn(async () => {})
const mockResolveWorkflow = jest.fn(async () => 1)
jest.mock('./vmJobRunner', () => ({
    __private__: {
        writeStatusComment: (...args) => mockWriteStatusComment(...args),
        notifyVmResultChannels: (...args) => mockNotifyResultChannels(...args),
        resolveWorkflowAfterVmJobSettlement: (...args) => mockResolveWorkflow(...args),
    },
}))

jest.mock('./vmJob', () => ({
    VM_JOB_GOLD_REFUND_SOURCE: 'vm_execution_refund',
    launchQueuedVmJob: jest.fn(async () => ({ success: true })),
}))

const {
    reconcileVmWorkerTerminations,
    VM_WORKER_TERMINATED_FAILURE_REASON,
    VM_WORKER_TERMINATED_TEXT,
} = require('./vmJobReconciliation')

describe('reconcileVmWorkerTerminations', () => {
    const now = 1786438000000

    beforeEach(() => {
        docs.clear()
        jest.clearAllMocks()
    })

    test('settles an expired job whose exact Cloud Run execution terminated', async () => {
        docs.set('pendingWebhooks/correlation-1', {
            kind: 'vm_job',
            correlationId: 'correlation-1',
            status: 'initiated',
            launchState: 'launched',
            executionAttemptId: 'attempt-2',
            leaseExpiresAt: now - 60000,
            launchRequestedAt: now - 10 * 60000,
            userId: 'user-1',
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            assistantId: 'assistant-1',
            statusCommentId: 'comment-1',
            goldCharged: 20,
            runtimeGoldCharged: 120,
            proxyTokenGoldCharged: 0,
        })
        docs.set('vmSessions/project-1__task-1', {
            sandboxId: 'dead-sandbox',
            status: 'busy',
            activeCorrelationId: 'correlation-1',
            activeLeaseOwner: 'worker-1',
            activeLeaseExpiresAt: now - 60000,
            blockedByCorrelationId: 'correlation-1',
        })
        mockFindExecution.mockResolvedValue({
            name: 'projects/test/locations/europe-west1/jobs/vm-job-runner/executions/execution-2',
            completionTime: '2026-08-11T08:44:36Z',
        })

        await expect(reconcileVmWorkerTerminations(now)).resolves.toEqual({
            checked: 1,
            claimed: 1,
            reconciled: 1,
            running: 0,
            errors: 0,
        })

        expect(mockFindExecution).toHaveBeenCalledWith(
            'correlation-1',
            expect.objectContaining({ executionAttemptId: 'attempt-2' })
        )
        expect(mockRefundGold).toHaveBeenCalledWith(
            'user-1',
            140,
            expect.objectContaining({ idempotencyKey: 'vm_job_refund:correlation-1' })
        )
        expect(mockWriteStatusComment).toHaveBeenCalledWith(
            expect.objectContaining({ correlationId: 'correlation-1' }),
            VM_WORKER_TERMINATED_TEXT,
            expect.objectContaining({ assistantRunStatus: 'failed' })
        )
        expect(mockApplyFailureHold).toHaveBeenCalledWith(
            mockFirestore,
            expect.objectContaining({ correlationId: 'correlation-1' }),
            expect.objectContaining({ failureReason: VM_WORKER_TERMINATED_FAILURE_REASON })
        )
        expect(docs.get('pendingWebhooks/correlation-1')).toEqual(
            expect.objectContaining({
                status: 'failed',
                failureReason: VM_WORKER_TERMINATED_FAILURE_REASON,
                workerReconciliationState: 'complete',
                goldRefunded: 140,
            })
        )
        expect(docs.get('vmSessions/project-1__task-1')).toEqual(
            expect.objectContaining({
                sandboxId: null,
                status: 'failed',
                activeCorrelationId: null,
                activeLeaseOwner: null,
                blockedByCorrelationId: null,
            })
        )
        expect(mockNotifyResultChannels).toHaveBeenCalledTimes(1)
        expect(mockResolveWorkflow).toHaveBeenCalledTimes(1)
        expect(mockAdvanceQueue).toHaveBeenCalledTimes(1)
    })

    test('does not hand a thread now owned by a newer run to its queued follow-up', async () => {
        docs.set('pendingWebhooks/correlation-1', {
            kind: 'vm_job',
            correlationId: 'correlation-1',
            status: 'initiated',
            executionAttemptId: 'attempt-2',
            leaseExpiresAt: now - 60000,
            userId: 'user-1',
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            goldCharged: 20,
        })
        const session = {
            status: 'busy',
            activeCorrelationId: 'newer-run',
            activeLeaseOwner: 'dispatch:newer-run',
            activeLeaseExpiresAt: now + 60000,
            queue: ['follow-up'],
            queueLength: 1,
        }
        docs.set('vmSessions/project-1__task-1', session)
        mockFindExecution.mockResolvedValue({ completionTime: '2026-08-11T08:44:36Z' })

        await expect(reconcileVmWorkerTerminations(now)).resolves.toEqual(expect.objectContaining({ reconciled: 1 }))
        expect(docs.get('vmSessions/project-1__task-1')).toEqual(session)
        expect(mockAdvanceQueue).not.toHaveBeenCalled()
    })

    test('leaves a Cloud Run execution alone while it is still active', async () => {
        docs.set('pendingWebhooks/correlation-1', {
            kind: 'vm_job',
            correlationId: 'correlation-1',
            status: 'initiated',
            executionAttemptId: 'attempt-2',
            leaseExpiresAt: now - 60000,
        })
        mockFindExecution.mockResolvedValue({ runningCount: 1 })

        await expect(reconcileVmWorkerTerminations(now)).resolves.toEqual({
            checked: 1,
            claimed: 0,
            reconciled: 0,
            running: 1,
            errors: 0,
        })
        expect(mockRefundGold).not.toHaveBeenCalled()
        expect(docs.get('pendingWebhooks/correlation-1').status).toBe('initiated')
    })
})

// AT-2916: the Anna VM overview kept showing a "Wird gestoppt…" card for hours (and the count
// disagreed with the Workflows view) because a stop pressed during sandbox start-up cancelled the
// Cloud Run execution before the runner ever claimed the job. The runner is the only thing that
// settles cancel_requested, so the job stayed active forever. This is that production record.
describe('reconcileVmWorkerTerminations — cancels orphaned by a killed execution (AT-2916)', () => {
    const now = 1793276900000
    const executionName =
        'projects/alldonealeph/locations/europe-west1/jobs/vm-job-runner/executions/vm-job-runner-w9cpl'
    const orphan = (overrides = {}) => ({
        kind: 'vm_job',
        correlationId: 'stale-run',
        status: 'cancel_requested',
        launchState: 'launched',
        executionAttemptId: 'attempt-1',
        launchRequestedAt: now - 3 * 60 * 60 * 1000,
        launchedAt: now - 3 * 60 * 60 * 1000 + 500,
        cancelRequestedAt: now - 3 * 60 * 60 * 1000 + 13000,
        cloudRunExecution: executionName,
        cloudRunCancelRequestSucceeded: true,
        userId: 'user-1',
        projectId: 'project-1',
        objectType: 'tasks',
        objectId: 'task-1',
        statusCommentId: 'comment-1',
        goldCharged: 20,
        runtimeGoldCharged: 10,
        ...overrides,
    })
    const newerRunSession = {
        sandboxId: 'live-sandbox',
        status: 'busy',
        activeCorrelationId: 'newer-run',
        activeLeaseOwner: 'newer-run-worker',
        activeLeaseExpiresAt: now + 60000,
        queue: ['queued-follow-up'],
        queueLength: 1,
    }

    beforeEach(() => {
        docs.clear()
        jest.clearAllMocks()
        mockFindExecution.mockResolvedValue(null)
        mockGetExecution.mockResolvedValue(null)
    })

    test('settles it as cancelled, like the runner would, without touching the newer run on the thread', async () => {
        docs.set('pendingWebhooks/stale-run', orphan())
        docs.set('vmSessions/project-1__task-1', newerRunSession)
        // Hours later the paged lookup no longer reaches it; the stored execution name still does.
        mockGetExecution.mockResolvedValue({
            name: executionName,
            correlationId: 'stale-run',
            attemptId: 'attempt-1',
            cancelledCount: 1,
        })

        await expect(reconcileVmWorkerTerminations(now)).resolves.toEqual(
            expect.objectContaining({ checked: 1, claimed: 1, reconciled: 1, errors: 0 })
        )

        expect(mockGetExecution).toHaveBeenCalledWith(executionName)
        expect(docs.get('pendingWebhooks/stale-run')).toEqual(
            expect.objectContaining({
                status: 'cancelled',
                cancelledAt: now,
                workerReconciliationOutcome: 'cancelled',
                workerReconciliationState: 'complete',
                goldRefunded: 20,
            })
        )
        expect(docs.get('pendingWebhooks/stale-run').failureReason).toBeUndefined()
        // Only the base reserve, as in the runner's cancel path, and under the shared key.
        expect(mockRefundGold).toHaveBeenCalledTimes(1)
        expect(mockRefundGold).toHaveBeenCalledWith(
            'user-1',
            20,
            expect.objectContaining({ idempotencyKey: 'vm_job_refund:stale-run' })
        )
        expect(mockWriteStatusComment).toHaveBeenCalledWith(
            expect.objectContaining({ correlationId: 'stale-run' }),
            'Stopped.',
            { assistantRunStatus: 'cancelled' }
        )
        expect(mockApplyFailureHold).not.toHaveBeenCalled()
        expect(mockNotifyResultChannels).not.toHaveBeenCalled()
        expect(mockResolveWorkflow).toHaveBeenCalledTimes(1)
        // The thread belongs to the newer run: no session reset, no queue hand-off over it.
        expect(docs.get('vmSessions/project-1__task-1')).toEqual(newerRunSession)
        expect(mockAdvanceQueue).not.toHaveBeenCalled()
    })

    test('releases the thread and hands it to a queued follow-up when the orphan still held it', async () => {
        docs.set('pendingWebhooks/stale-run', orphan())
        docs.set('vmSessions/project-1__task-1', {
            status: 'busy',
            activeCorrelationId: 'stale-run',
            activeLeaseOwner: 'dispatch:stale-run',
            activeLeaseExpiresAt: now - 60000,
        })
        mockFindExecution.mockResolvedValue({ correlationId: 'stale-run', cancelledCount: 1 })

        await reconcileVmWorkerTerminations(now)

        expect(docs.get('vmSessions/project-1__task-1')).toEqual(
            expect.objectContaining({ activeCorrelationId: null, activeLeaseOwner: null, sandboxId: null })
        )
        expect(mockAdvanceQueue).toHaveBeenCalledTimes(1)
    })

    test('waits while the runner can still settle the cancel itself', async () => {
        docs.set('pendingWebhooks/stale-run', orphan({ cancelRequestedAt: now - 30000 }))

        await expect(reconcileVmWorkerTerminations(now)).resolves.toEqual(expect.objectContaining({ checked: 0 }))
        expect(mockFindExecution).not.toHaveBeenCalled()
        expect(docs.get('pendingWebhooks/stale-run').status).toBe('cancel_requested')
    })

    test('never settles a cancel whose execution is still running, even with its lease expired', async () => {
        // The heartbeat stops renewing once status leaves 'initiated', so the lease says nothing.
        docs.set('pendingWebhooks/stale-run', orphan({ leaseOwner: 'worker', leaseExpiresAt: now - 5 * 60000 }))
        mockFindExecution.mockResolvedValue({ correlationId: 'stale-run', runningCount: 1 })

        await expect(reconcileVmWorkerTerminations(now)).resolves.toEqual(
            expect.objectContaining({ checked: 1, claimed: 0, running: 1 })
        )
        expect(docs.get('pendingWebhooks/stale-run').status).toBe('cancel_requested')
        expect(mockRefundGold).not.toHaveBeenCalled()
    })

    test('does not adopt a stored execution from another launch attempt', async () => {
        // A cancel while awaiting the user relaunches the runner with a new attempt id; the old
        // execution being over says nothing about the new one.
        docs.set('pendingWebhooks/stale-run', orphan({ executionAttemptId: 'attempt-2' }))
        mockGetExecution.mockResolvedValue({ correlationId: 'stale-run', attemptId: 'attempt-1', cancelledCount: 1 })

        await reconcileVmWorkerTerminations(now)

        expect(docs.get('pendingWebhooks/stale-run').status).toBe('cancel_requested')
    })

    test('treats an execution that cannot be found as gone only after Cloud Run would have killed it', async () => {
        docs.set('pendingWebhooks/stale-run', orphan())

        await reconcileVmWorkerTerminations(now)
        expect(docs.get('pendingWebhooks/stale-run').status).toBe('cancel_requested')

        const muchLater = now + 3 * 60 * 60 * 1000
        await reconcileVmWorkerTerminations(muchLater)
        expect(docs.get('pendingWebhooks/stale-run')).toEqual(
            expect.objectContaining({ status: 'cancelled', workerExecutionOutcome: 'not_found' })
        )
    })

    test('leaves a cancel whose launch was never confirmed to the launch reconciler', async () => {
        docs.set('pendingWebhooks/stale-run', orphan({ launchState: 'unknown' }))

        await reconcileVmWorkerTerminations(now)

        expect(mockFindExecution).not.toHaveBeenCalled()
        expect(docs.get('pendingWebhooks/stale-run').status).toBe('cancel_requested')
    })
})
