const mockDocs = {}
const mockQueueEnqueue = jest.fn(async () => {})
const mockHasVmSubscription = jest.fn(async () => false)
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

jest.mock('firebase-admin', () => ({
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
    firestore: jest.fn(() => ({
        collection: jest.fn(() => mockCollectionQuery),
        doc: jest.fn(path => mockGetDoc(path)),
    })),
}))

jest.mock(
    'firebase-admin/functions',
    () => ({
        getFunctions: jest.fn(() => ({
            taskQueue: jest.fn(() => ({
                enqueue: mockQueueEnqueue,
            })),
        })),
    }),
    { virtual: true }
)

jest.mock('./assistantStatusHelper', () => ({
    createInitialStatusMessage: jest.fn(async () => 'status-comment-1'),
}))

jest.mock('../Gold/goldHelper', () => ({
    deductGold: jest.fn(async () => ({ success: true })),
    refundGold: jest.fn(async () => ({ success: true })),
}))

jest.mock('./vmSubscriptionAuth', () => ({
    hasVmSubscription: mockHasVmSubscription,
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
        mockQueueEnqueue.mockResolvedValue(undefined)
        mockHasVmSubscription.mockResolvedValue(false)
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('correlation-1')
    })

    afterEach(() => {
        crypto.randomUUID.mockRestore()
    })

    test('admits five concurrent jobs and rejects the sixth before charging or enqueueing it', async () => {
        expect(MAX_CONCURRENT_VM_JOBS_PER_USER).toBe(5)
        expect(MAX_CONCURRENT_VM_JOBS).toBe(5)
        expect(VM_JOB_QUEUE_RATE_LIMITS).toEqual({
            maxConcurrentDispatches: 5,
            maxDispatchesPerSecond: 1,
        })
        ;[0, 1, 2, 3, 4, 5].forEach(activeJobs => {
            mockCollectionQuery.get.mockResolvedValueOnce({ size: activeJobs })
        })
        crypto.randomUUID.mockImplementation(() => `correlation-${crypto.randomUUID.mock.calls.length}`)

        const results = []
        for (let jobNumber = 1; jobNumber <= 6; jobNumber += 1) {
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

        expect(results.slice(0, 5).every(result => result.success && result.status === 'started')).toBe(true)
        expect(results[5]).toEqual({
            success: false,
            message: 'You already have 5 VM tasks running. Please wait for one to finish before starting another.',
        })
        expect(deductGold).toHaveBeenCalledTimes(5)
        expect(mockQueueEnqueue).toHaveBeenCalledTimes(5)
        expect(createInitialStatusMessage).toHaveBeenCalledTimes(5)
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
            data: () => ({ defaultVmAgent: 'codex' }),
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
            expect.objectContaining({ agent: 'codex', agentModel: 'gpt-5.6-sol' })
        )
    })

    test('lets an explicit agent override the requesting user default', async () => {
        mockGetDoc('users/user-1').get.mockResolvedValueOnce({
            exists: true,
            data: () => ({ defaultVmAgent: 'codex' }),
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

        expect(mockGetDoc('users/user-1').get).not.toHaveBeenCalled()
        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'claude', agentModel: 'opus' })
        )
    })

    test('keeps Claude as the launch fallback for users without a preference', async () => {
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
            expect.objectContaining({ agent: 'claude', agentModel: 'opus' })
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
        mockHasVmSubscription.mockResolvedValueOnce(true)

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
})
