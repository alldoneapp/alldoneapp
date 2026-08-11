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
jest.mock('./vmCloudRunLauncher', () => ({
    findVmCloudRunExecution: (...args) => mockFindExecution(...args),
    __private__: {
        classifyVmCloudRunExecution: execution =>
            execution?.completionTime
                ? { terminal: true, outcome: 'failed', reason: 'NON_ZERO_EXIT_CODE', message: 'Container exited.' }
                : { terminal: false, outcome: 'running', message: '' },
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
