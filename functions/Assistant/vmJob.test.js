const mockDocs = {}
const mockQueueEnqueue = jest.fn(async () => ({
    executionName: 'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/execution-1',
    operationName: 'projects/test-project/locations/europe-west1/operations/operation-1',
}))
const mockLegacyQueueEnqueue = jest.fn(async () => {})
const originalCloudRunJobsEnabled = process.env.VM_CLOUD_RUN_JOBS_ENABLED
const mockResolveVmCredentialMode = jest.fn(async () => 'api')
const mockCollectionQuery = {
    where: jest.fn(() => mockCollectionQuery),
    get: jest.fn(async () => ({ size: 0 })),
}

function mockGetDoc(path) {
    if (!mockDocs[path]) {
        mockDocs[path] = {
            get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }
    }
    return mockDocs[path]
}

jest.mock(
    'firebase-admin',
    () => ({
        app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
        firestore: jest.fn(() => ({
            collection: jest.fn(() => mockCollectionQuery),
            doc: jest.fn(path => mockGetDoc(path)),
        })),
    }),
    { virtual: true }
)

jest.mock(
    'firebase-admin/functions',
    () => ({
        getFunctions: jest.fn(() => ({
            taskQueue: jest.fn(() => ({
                enqueue: mockLegacyQueueEnqueue,
            })),
        })),
    }),
    { virtual: true }
)

jest.mock('./vmCloudRunLauncher', () => ({
    launchVmCloudRunJob: mockQueueEnqueue,
}))

jest.mock('./assistantStatusHelper', () => ({
    createInitialStatusMessage: jest.fn(async () => 'status-comment-1'),
}))

jest.mock('../Gold/goldHelper', () => ({
    deductGold: jest.fn(async () => ({ success: true })),
    refundGold: jest.fn(async () => ({ success: true })),
}))

jest.mock('./vmApiKeyAuth', () => ({
    resolveVmCredentialMode: mockResolveVmCredentialMode,
}))

const crypto = require('crypto')
const { createInitialStatusMessage } = require('./assistantStatusHelper')
const { deductGold } = require('../Gold/goldHelper')
const { startVmJob, MAX_CONCURRENT_VM_JOBS_PER_USER } = require('./vmJob')
const { MAX_CONCURRENT_VM_JOBS, VM_JOB_QUEUE_RATE_LIMITS } = require('./vmJobConfig')

describe('startVmJob', () => {
    beforeEach(() => {
        Object.keys(mockDocs).forEach(key => delete mockDocs[key])
        jest.clearAllMocks()
        mockCollectionQuery.get.mockResolvedValue({ size: 0 })
        mockQueueEnqueue.mockResolvedValue({
            executionName: 'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/execution-1',
            operationName: 'projects/test-project/locations/europe-west1/operations/operation-1',
        })
        mockLegacyQueueEnqueue.mockResolvedValue(undefined)
        process.env.VM_CLOUD_RUN_JOBS_ENABLED = 'true'
        mockResolveVmCredentialMode.mockResolvedValue('api')
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('correlation-1')
    })

    afterEach(() => {
        crypto.randomUUID.mockRestore()
    })

    afterAll(() => {
        if (originalCloudRunJobsEnabled === undefined) delete process.env.VM_CLOUD_RUN_JOBS_ENABLED
        else process.env.VM_CLOUD_RUN_JOBS_ENABLED = originalCloudRunJobsEnabled
    })

    test('keeps the Cloud Tasks rollback path until Cloud Run is enabled for the environment', async () => {
        delete process.env.VM_CLOUD_RUN_JOBS_ENABLED

        const result = await startVmJob({
            objective: 'Research this',
            taskType: 'research',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(result.success).toBe(true)
        expect(mockLegacyQueueEnqueue).toHaveBeenCalledWith({ correlationId: 'correlation-1' })
        expect(mockQueueEnqueue).not.toHaveBeenCalled()
        expect(mockDocs['pendingWebhooks/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ launchBackend: 'cloud_tasks', launchState: 'launched' }),
            { merge: true }
        )
    })

    test('admits ten concurrent jobs and rejects the eleventh before charging or enqueueing it', async () => {
        expect(MAX_CONCURRENT_VM_JOBS_PER_USER).toBe(10)
        expect(MAX_CONCURRENT_VM_JOBS).toBe(10)
        expect(VM_JOB_QUEUE_RATE_LIMITS).toEqual({
            maxConcurrentDispatches: 10,
            maxDispatchesPerSecond: 1,
        })
        ;[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(activeJobs => {
            mockCollectionQuery.get.mockResolvedValueOnce({ size: activeJobs })
        })
        crypto.randomUUID.mockImplementation(() => `correlation-${crypto.randomUUID.mock.calls.length}`)

        const results = []
        for (let jobNumber = 1; jobNumber <= 11; jobNumber += 1) {
            results.push(
                await startVmJob({
                    objective: `Run job ${jobNumber}`,
                    taskType: 'prototype',
                    agent: 'claude',
                    projectId: 'project-1',
                    objectType: 'topics',
                    objectId: `chat-${jobNumber}`,
                    assistantId: 'assistant-1',
                    requestUserId: 'user-1',
                })
            )
        }

        expect(results.slice(0, 10).every(result => result.success && result.status === 'started')).toBe(true)
        expect(results[10]).toEqual({
            success: false,
            message: 'You already have 10 VM tasks running. Please wait for one to finish before starting another.',
        })
        expect(deductGold).toHaveBeenCalledTimes(10)
        expect(mockQueueEnqueue).toHaveBeenCalledTimes(10)
        expect(createInitialStatusMessage).toHaveBeenCalledTimes(10)
    })

    test('persists WhatsApp notification target for WhatsApp-originated VM jobs', async () => {
        await startVmJob({
            objective: 'Research this',
            taskType: 'research',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
            triggerChannel: 'whatsapp',
            whatsappTo: ' whatsapp:+123 ',
        })

        expect(mockDocs['pendingWebhooks/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
            })
        )
    })

    test('does not persist WhatsApp fields for app-originated VM jobs', async () => {
        await startVmJob({
            objective: 'Research this',
            taskType: 'research',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        const payload = mockDocs['pendingWebhooks/correlation-1'].set.mock.calls[0][0]
        expect(payload).not.toHaveProperty('triggerChannel')
        expect(payload).not.toHaveProperty('whatsappTo')
    })

    test('names the selected agent, model and effort in the user-visible VM status', async () => {
        const result = await startVmJob({
            objective: 'Change the code',
            taskType: 'prototype',
            agent: 'codex',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        // No model/effort passed → the per-agent defaults (Codex: gpt-5.6-sol · medium) are surfaced.
        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'chat-1',
            'assistant-1',
            '🖥️ Spinning up Codex (gpt-5.6-sol · medium effort) in a VM to work on this…\n\n🔑 Using Alldone API billing. VM tokens will cost Gold.',
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
        expect(result.message).toContain('VM task started with Codex')
        expect(deductGold).toHaveBeenCalledWith('user-1', 20, expect.objectContaining({ source: 'vm_execution' }))
        expect(mockDocs['pendingWebhooks/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ goldCharged: 20 })
        )
    })

    test('uses the requesting user default when the launch omits an agent', async () => {
        mockGetDoc('users/user-1').get.mockResolvedValueOnce({
            exists: true,
            data: () => ({ defaultVmAgent: 'codex', defaultVmAgentReasoningEffort: 'xhigh' }),
        })

        await startVmJob({
            objective: 'Change the code',
            taskType: 'prototype',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({
                agent: 'codex',
                agentModel: 'gpt-5.6-sol',
                agentReasoningEffort: 'xhigh',
            })
        )
    })

    test('lets an explicit agent override the requesting user default', async () => {
        mockGetDoc('users/user-1').get.mockResolvedValueOnce({
            exists: true,
            data: () => ({ defaultVmAgent: 'codex', defaultVmAgentReasoningEffort: 'xhigh' }),
        })

        await startVmJob({
            objective: 'Research this',
            taskType: 'research',
            agent: 'claude',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'claude', agentModel: 'opus', agentReasoningEffort: 'xhigh' })
        )
    })

    test('uses Codex with medium effort for users without a preference', async () => {
        await startVmJob({
            objective: 'Research this',
            taskType: 'research',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'codex', agentModel: 'gpt-5.6-sol', agentReasoningEffort: 'medium' })
        )
    })

    test.each(['claude', 'codex'])('applies the user default effort to %s', async selectedAgent => {
        mockGetDoc('users/user-1').get.mockResolvedValueOnce({
            exists: true,
            data: () => ({ defaultVmAgentReasoningEffort: 'high' }),
        })

        await startVmJob({
            objective: 'Work on this',
            taskType: 'prototype',
            agent: selectedAgent,
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ agent: selectedAgent, agentReasoningEffort: 'high' })
        )
    })

    test('lets an explicit effort override the user default', async () => {
        mockGetDoc('users/user-1').get.mockResolvedValueOnce({
            exists: true,
            data: () => ({ defaultVmAgent: 'codex', defaultVmAgentReasoningEffort: 'xhigh' }),
        })

        await startVmJob({
            objective: 'Work on this',
            taskType: 'prototype',
            agentReasoningEffort: 'low',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'codex', agentReasoningEffort: 'low' })
        )
    })

    test('rejects an invalid explicitly requested agent', async () => {
        const result = await startVmJob({
            objective: 'Research this',
            taskType: 'research',
            agent: 'other',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(result).toEqual({ success: false, message: 'agent must be one of: claude, codex.' })
        expect(deductGold).not.toHaveBeenCalled()
    })

    test('surfaces an explicitly chosen model and effort in the VM status', async () => {
        await startVmJob({
            objective: 'Change the code',
            taskType: 'prototype',
            agent: 'claude',
            agentModel: 'sonnet',
            agentReasoningEffort: 'medium',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'chat-1',
            'assistant-1',
            '🖥️ Spinning up Claude (sonnet · medium effort) in a VM to work on this…\n\n🔑 Using Alldone API billing. VM tokens will cost Gold.',
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
    })

    test('clamps legacy Codex minimal effort requests to low', async () => {
        await startVmJob({
            objective: 'Reply briefly',
            taskType: 'prototype',
            agent: 'codex',
            agentReasoningEffort: 'minimal',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'chat-1',
            'assistant-1',
            '🖥️ Spinning up Codex (gpt-5.6-sol · low effort) in a VM to work on this…\n\n🔑 Using Alldone API billing. VM tokens will cost Gold.',
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ agentReasoningEffort: 'low' })
        )
    })

    test('announces and persists personal subscription billing', async () => {
        mockResolveVmCredentialMode.mockResolvedValueOnce('subscription')

        await startVmJob({
            objective: 'Change the code',
            taskType: 'prototype',
            agent: 'codex',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'chat-1',
            'assistant-1',
            expect.stringContaining('🔐 Using your Codex subscription. VM tokens will not cost Gold.'),
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ credentialMode: 'subscription', subscriptionUsed: true })
        )
    })

    test('gives an explicitly selected personal API key precedence without charging token Gold', async () => {
        mockResolveVmCredentialMode.mockResolvedValueOnce('byok')

        const result = await startVmJob({
            objective: 'Change the code',
            taskType: 'prototype',
            agent: 'codex',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'chat-1',
            'assistant-1',
            expect.stringContaining('Using your personal Codex API key'),
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({
                credentialMode: 'byok',
                personalApiKeyUsed: true,
                tokenBillingExempt: true,
                subscriptionUsed: false,
            })
        )
        expect(result.message).toContain('your personal API key')
    })
})
