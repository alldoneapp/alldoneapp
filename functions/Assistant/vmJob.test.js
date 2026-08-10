const mockDocs = {}
const mockQueueEnqueue = jest.fn(async () => ({
    executionName: 'projects/test-project/locations/europe-west1/jobs/vm-job-runner/executions/execution-1',
    operationName: 'projects/test-project/locations/europe-west1/operations/operation-1',
}))
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

jest.mock('firebase-admin', () => ({
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
    firestore: Object.assign(
        jest.fn(() => ({
            collection: jest.fn(() => mockCollectionQuery),
            doc: jest.fn(path => mockGetDoc(path)),
            runTransaction: async updateFn =>
                updateFn({
                    get: async ref => ref.get(),
                    set: (ref, data, options) => ref.set(data, options),
                    update: (ref, data) => ref.update(data),
                    delete: ref => (ref.delete ? ref.delete() : undefined),
                }),
        })),
        { Timestamp: { now: () => ({ seconds: 0, nanoseconds: 0 }) } }
    ),
}))

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

// Deterministic model catalog — discovery itself is covered by vmAgentModelCatalog.test.js.
// Mirrors the real contract: Claude alias families resolve to the alias, Codex to a concrete id.
jest.mock('./vmAgentModelCatalog', () => ({
    // Keep the real helpers (vmAgentSettings imports isValidFamilyId from here); stub only the
    // network-backed resolver.
    ...jest.requireActual('./vmAgentModelCatalog'),
    // The platform OpenRouter key is an environment fact; the tests that care set it explicitly.
    isOpenRouterConfigured: jest.fn(() => true),
    resolveFamilyToModel: jest.fn(async (provider, family) => {
        // An OpenRouter selection resolves to itself, prefix intact — see vmAgentModelCatalog.
        if (typeof family === 'string' && family.startsWith('openrouter:')) {
            return family === 'openrouter:nope/not-real' ? null : family
        }
        const catalog = {
            claude: { opus: 'opus', sonnet: 'sonnet', haiku: 'haiku', fable: 'claude-fable-5' },
            codex: { sol: 'gpt-5.6-sol', terra: 'gpt-5.6-terra', luna: 'gpt-5.6-luna' },
        }
        return (catalog[provider] || {})[family] || null
    }),
}))

const crypto = require('crypto')
const { createInitialStatusMessage } = require('./assistantStatusHelper')
const { deductGold } = require('../Gold/goldHelper')
const {
    startVmJob,
    launchQueuedVmJob,
    MAX_CONCURRENT_VM_JOBS_PER_USER,
    DEFAULT_CLAUDE_MODEL,
    formatAgentModelLabel,
} = require('./vmJob')
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
        mockResolveVmCredentialMode.mockResolvedValue('api')
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('correlation-1')
    })

    afterEach(() => {
        crypto.randomUUID.mockRestore()
    })

    test('always launches the detached Cloud Run job without a feature flag', async () => {
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
        expect(mockQueueEnqueue).toHaveBeenCalledTimes(1)
        expect(mockDocs['pendingWebhooks/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ launchBackend: 'cloud_run_job', launchState: 'requested' }),
            { merge: true }
        )
        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ threadRunOrder: 1, threadRunCreatedAt: expect.any(Number) })
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
            requestText: 'please run this one with codex',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        // No model/effort passed → the per-agent defaults are surfaced, named by tier (Sol 5.6 · medium).
        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'chat-1',
            'assistant-1',
            '🖥️ Spinning up Codex (Sol 5.6 · medium effort) in a VM to work on this…\n\n🔑 Using Alldone API billing. VM tokens will cost Gold.',
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
        // startVmJob reads the user doc twice per launch (approval policy, then agent
        // settings) — the stored preferences must answer every read, not just the first.
        mockGetDoc('users/user-1').get.mockResolvedValue({
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
        mockGetDoc('users/user-1').get.mockResolvedValue({
            exists: true,
            data: () => ({ defaultVmAgent: 'codex', defaultVmAgentReasoningEffort: 'xhigh' }),
        })

        await startVmJob({
            objective: 'Research this',
            taskType: 'research',
            agent: 'claude',
            requestText: 'do this one with claude',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ agent: 'claude', agentModel: 'opus', agentReasoningEffort: 'xhigh' })
        )
        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'chat-1',
            'assistant-1',
            '🖥️ Spinning up Claude (Opus latest; resolving version… · xhigh effort) in a VM to work on this…\n\n🔑 Using Alldone API billing. VM tokens will cost Gold.',
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
    })

    // AT-2224: the assistant fills these arguments in on its own — a workflow step for a coding task
    // asked for Codex while the user's saved default was Claude. An override only outranks the saved
    // preference when the user's own words asked for it.
    describe('per-run overrides the request does not ask for', () => {
        // What the user actually wrote for the workflow step that reproduced the bug.
        const workflowStepPrompt = 'Work on this task in the VM in interactive mode. Ask questions to clarify.'

        test('keeps the saved Claude default when the assistant invents Codex', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgent: 'claude', defaultVmAgentReasoningEffort: 'high' }),
            })

            await startVmJob({
                objective: 'Implement the task in the connected repository',
                taskType: 'prototype',
                agent: 'codex',
                agentModel: 'gpt-5.6-sol',
                requestText: workflowStepPrompt,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
            })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'claude', agentModel: 'opus', agentReasoningEffort: 'high' })
            )
        })

        test('keeps the saved Codex default when the assistant invents Claude', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgent: 'codex', defaultVmAgentReasoningEffort: 'high' }),
            })

            await startVmJob({
                objective: 'Research this thoroughly and write it up',
                taskType: 'research',
                agent: 'claude',
                requestText: workflowStepPrompt,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
            })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'codex', agentModel: 'gpt-5.6-sol', agentReasoningEffort: 'high' })
            )
        })

        test('keeps the saved effort and approval policy when the assistant invents them', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({
                    defaultVmAgent: 'claude',
                    defaultVmAgentReasoningEffort: 'high',
                    defaultVmApprovalPolicy: 'permissive',
                }),
            })

            await startVmJob({
                objective: 'Implement the task in the connected repository',
                taskType: 'prototype',
                executionMode: 'interactive',
                agentReasoningEffort: 'medium',
                approvalPolicy: 'balanced',
                requestText: workflowStepPrompt,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
            })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({
                    agent: 'claude',
                    agentReasoningEffort: 'high',
                    approvalPolicy: 'permissive',
                })
            )
        })

        test('still honours an agent the user explicitly asked for in the same request', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgent: 'claude', defaultVmAgentReasoningEffort: 'high' }),
            })

            await startVmJob({
                objective: 'Implement the task in the connected repository',
                taskType: 'prototype',
                agent: 'codex',
                requestText: 'Work on this task in the VM, but use codex this time.',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
            })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'codex', agentReasoningEffort: 'high' })
            )
        })

        test('falls back to the system default when the stored preference is invalid', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgent: 'gemini', defaultVmAgentReasoningEffort: 'ludicrous' }),
            })

            await startVmJob({
                objective: 'Implement the task in the connected repository',
                taskType: 'prototype',
                agent: 'claude',
                requestText: workflowStepPrompt,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
            })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'codex', agentReasoningEffort: 'medium' })
            )
        })

        test('falls back to the system default when the user doc is missing', async () => {
            await startVmJob({
                objective: 'Implement the task in the connected repository',
                taskType: 'prototype',
                agent: 'claude',
                requestText: workflowStepPrompt,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
            })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'codex', agentReasoningEffort: 'medium' })
            )
        })

        test('still rejects an invalid explicitly requested agent instead of silently dropping it', async () => {
            const result = await startVmJob({
                objective: 'Implement the task in the connected repository',
                taskType: 'prototype',
                agent: 'gemini',
                requestText: workflowStepPrompt,
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
            })

            expect(result).toEqual({ success: false, message: 'agent must be one of: claude, codex.' })
            expect(deductGold).not.toHaveBeenCalled()
        })
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
        mockGetDoc('users/user-1').get.mockResolvedValue({
            exists: true,
            data: () => ({ defaultVmAgentReasoningEffort: 'high' }),
        })

        await startVmJob({
            objective: 'Work on this',
            taskType: 'prototype',
            agent: selectedAgent,
            requestText: `use ${selectedAgent} for this`,
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
        mockGetDoc('users/user-1').get.mockResolvedValue({
            exists: true,
            data: () => ({ defaultVmAgent: 'codex', defaultVmAgentReasoningEffort: 'xhigh' }),
        })

        await startVmJob({
            objective: 'Work on this',
            taskType: 'prototype',
            agentReasoningEffort: 'low',
            requestText: 'keep it quick — use low reasoning effort',
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

    test('defaults VM execution to automatic and persists an explicit interactive mode', async () => {
        await startVmJob({
            objective: 'Work with me on this',
            taskType: 'prototype',
            executionMode: 'interactive',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(mockDocs['pendingWebhooks/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ executionMode: 'interactive' })
        )
        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ executionMode: 'interactive' })
        )
    })

    test('rejects an invalid VM execution mode before billing', async () => {
        const result = await startVmJob({
            objective: 'Work on this',
            taskType: 'prototype',
            executionMode: 'unsafe',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(result).toEqual({
            success: false,
            message: 'executionMode must be one of: automatic, plan_first, interactive.',
        })
        expect(deductGold).not.toHaveBeenCalled()
    })

    test('surfaces an explicitly chosen model and effort in the VM status', async () => {
        await startVmJob({
            objective: 'Change the code',
            taskType: 'prototype',
            agent: 'claude',
            agentModel: 'sonnet',
            agentReasoningEffort: 'medium',
            requestText: 'run it with claude on sonnet at medium reasoning effort',
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
            '🖥️ Spinning up Claude (Sonnet latest; resolving version… · medium effort) in a VM to work on this…\n\n🔑 Using Alldone API billing. VM tokens will cost Gold.',
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
    })

    test.each([
        ['opus', 'opus'],
        ['fable', 'claude-fable-5'],
        ['claude-fable-5', 'claude-fable-5'],
        ['claude-opus-5', 'claude-opus-5'],
    ])('accepts Claude model %s and persists it as %s', async (agentModel, expectedModel) => {
        await startVmJob({
            objective: 'Research this',
            taskType: 'research',
            agent: 'claude',
            agentModel,
            requestText: `use claude with model ${agentModel}`,
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ agentModel: expectedModel })
        )
    })

    test('uses Claude Code moving Opus alias as the default', () => {
        expect(DEFAULT_CLAUDE_MODEL).toBe('opus')
    })

    test.each([
        ['opus', 'Opus latest; resolving version…'],
        ['claude-opus-5', 'Opus 5.0'],
        ['claude-opus-4-8', 'Opus 4.8'],
        ['claude-opus-4-1-20250805', 'Opus 4.1'],
        ['claude-opus-4-20250514', 'Opus 4.0'],
    ])('derives the displayed Opus version from %s', (model, expectedLabel) => {
        expect(formatAgentModelLabel(model)).toBe(expectedLabel)
    })

    // AT-2221: the label is family-aware for every tier, not just Opus — otherwise picking
    // "Sonnet" in Settings would show a raw id while "Opus" showed a friendly version.
    test.each([
        ['sonnet', 'Sonnet latest; resolving version…'],
        ['haiku', 'Haiku latest; resolving version…'],
        ['claude-sonnet-5', 'Sonnet 5.0'],
        ['claude-sonnet-4-6', 'Sonnet 4.6'],
        ['claude-haiku-4-5', 'Haiku 4.5'],
        ['claude-fable-5', 'Fable 5.0'],
        ['gpt-5.6-sol', 'Sol 5.6'],
        ['gpt-5.6-terra', 'Terra 5.6'],
        ['gpt-5.6-luna', 'Luna 5.6'],
    ])('names the model tier for %s', (model, expectedLabel) => {
        expect(formatAgentModelLabel(model)).toBe(expectedLabel)
    })

    test('leaves an unrecognised model id untouched rather than mangling it', () => {
        expect(formatAgentModelLabel('o3-mini')).toBe('o3-mini')
        expect(formatAgentModelLabel('')).toBe('')
    })

    describe('default model family resolution (AT-2221)', () => {
        const baseArgs = {
            objective: 'Change the code',
            taskType: 'prototype',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        }

        test("applies the user's saved family for the selected agent", async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgentModel: { claude: 'sonnet', codex: 'terra' } }),
            })

            await startVmJob({ ...baseArgs, agent: 'claude', requestText: 'use claude for this' })
            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'claude', agentModel: 'sonnet' })
            )
        })

        test('resolves a Codex family to the newest concrete id', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgentModel: { claude: 'sonnet', codex: 'terra' } }),
            })

            await startVmJob({ ...baseArgs, agent: 'codex', requestText: 'use codex for this' })
            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'codex', agentModel: 'gpt-5.6-terra' })
            )
        })

        // AT-2224 × AT-2221: the assistant invents `agentModel` on its own. An uncorroborated one is
        // dropped by the override guard, which must leave the saved family in charge — not the
        // model the model asked for, and not the built-in constant.
        test('falls back to the saved family when the request never asked for the explicit model', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgent: 'claude', defaultVmAgentModel: { claude: 'sonnet' } }),
            })

            await startVmJob({ ...baseArgs, agent: 'claude', agentModel: 'haiku', requestText: 'fix the login bug' })
            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'claude', agentModel: 'sonnet' })
            )
        })

        test('lets an explicit agentModel override the saved family', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgentModel: { claude: 'sonnet' } }),
            })

            await startVmJob({
                ...baseArgs,
                agent: 'claude',
                agentModel: 'haiku',
                requestText: 'use claude with haiku for this',
            })
            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agentModel: 'haiku' })
            )
        })

        test('keeps the built-in default for a user with no saved family (backwards compatible)', async () => {
            await startVmJob({ ...baseArgs, agent: 'claude', requestText: 'use claude for this' })
            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agentModel: 'opus' })
            )
        })

        test('falls back to the agent default when the saved family cannot be resolved', async () => {
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgentModel: { codex: 'nonexistent' } }),
            })

            await startVmJob({ ...baseArgs, agent: 'codex' })
            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agentModel: 'gpt-5.6-sol' })
            )
        })
    })

    // AT-2230: OpenRouter models for the Codex harness.
    describe('OpenRouter models', () => {
        const baseArgs = {
            objective: 'Change the code',
            taskType: 'prototype',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        }

        const saveDefaultModel = selection =>
            mockGetDoc('users/user-1').get.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgentModel: { codex: selection } }),
            })

        test("applies the user's saved OpenRouter model, prefix intact", async () => {
            saveDefaultModel('openrouter:deepseek/deepseek-chat')

            await startVmJob({ ...baseArgs, agent: 'codex', requestText: 'use codex for this' })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agent: 'codex', agentModel: 'openrouter:deepseek/deepseek-chat' })
            )
        })

        test('honours an explicit OpenRouter model the user asked for by vendor name', async () => {
            await startVmJob({
                ...baseArgs,
                agent: 'codex',
                agentModel: 'openrouter:deepseek/deepseek-chat',
                requestText: 'run this one with deepseek please',
            })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agentModel: 'openrouter:deepseek/deepseek-chat' })
            )
        })

        test('names the model and its source in the status comment', async () => {
            saveDefaultModel('openrouter:deepseek/deepseek-chat')

            await startVmJob({ ...baseArgs, agent: 'codex', requestText: 'use codex for this' })

            expect(createInitialStatusMessage).toHaveBeenCalledWith(
                'project-1',
                'topics',
                'chat-1',
                'assistant-1',
                expect.stringContaining('DeepSeek Chat via OpenRouter'),
                expect.any(Array),
                expect.any(Array),
                expect.any(Array)
            )
        })

        // A ChatGPT subscription and a personal OpenAI key both authenticate against OpenAI and
        // cannot serve DeepSeek. Charging Gold silently to someone who believes they are on their
        // own subscription would be the worse outcome, so the run is pinned to API billing and says so.
        test('forces platform API billing even when the user has a subscription connected', async () => {
            mockResolveVmCredentialMode.mockResolvedValue('subscription')
            saveDefaultModel('openrouter:deepseek/deepseek-chat')

            await startVmJob({ ...baseArgs, agent: 'codex', requestText: 'use codex for this' })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ credentialMode: 'api', subscriptionUsed: false })
            )
            expect(createInitialStatusMessage).toHaveBeenCalledWith(
                'project-1',
                'topics',
                'chat-1',
                'assistant-1',
                expect.stringContaining('Using Alldone API billing'),
                expect.any(Array),
                expect.any(Array),
                expect.any(Array)
            )
        })

        test('rejects an OpenRouter model paired with Claude', async () => {
            await expect(
                startVmJob({
                    ...baseArgs,
                    agent: 'claude',
                    agentModel: 'openrouter:deepseek/deepseek-chat',
                    requestText: 'use claude with deepseek',
                })
            ).resolves.toMatchObject({ success: false, message: expect.stringContaining('agent="codex"') })
        })

        test('rejects a malformed OpenRouter id instead of putting it on a command line', async () => {
            await expect(
                startVmJob({
                    ...baseArgs,
                    agent: 'codex',
                    agentModel: 'openrouter:deepseek/deepseek; rm -rf /',
                    requestText: 'use codex with openrouter deepseek',
                })
            ).resolves.toMatchObject({ success: false })
        })

        // The proxy would reject the very first request; failing here means the base reserve and
        // per-minute Gold are never taken for a run that cannot work.
        test('refuses before charging any Gold when the platform key is not configured', async () => {
            require('./vmAgentModelCatalog').isOpenRouterConfigured.mockReturnValueOnce(false)

            await expect(
                startVmJob({
                    ...baseArgs,
                    agent: 'codex',
                    agentModel: 'openrouter:deepseek/deepseek-chat',
                    requestText: 'use deepseek for this',
                })
            ).resolves.toMatchObject({ success: false, message: expect.stringContaining('not available') })

            expect(deductGold).not.toHaveBeenCalled()
        })

        test('falls back to the agent default when the saved OpenRouter model no longer exists', async () => {
            saveDefaultModel('openrouter:nope/not-real')

            await startVmJob({ ...baseArgs, agent: 'codex', requestText: 'use codex for this' })

            expect(mockDocs['vmJobs/correlation-1'].set).toHaveBeenCalledWith(
                expect.objectContaining({ agentModel: 'gpt-5.6-sol' })
            )
        })
    })

    test('clamps legacy Codex minimal effort requests to low', async () => {
        await startVmJob({
            objective: 'Reply briefly',
            taskType: 'prototype',
            agent: 'codex',
            agentReasoningEffort: 'minimal',
            requestText: 'use codex with minimal reasoning effort',
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
            '🖥️ Spinning up Codex (Sol 5.6 · low effort) in a VM to work on this…\n\n🔑 Using Alldone API billing. VM tokens will cost Gold.',
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
            requestText: 'use codex for this',
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
            requestText: 'use codex for this',
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

    test('queues a follow-up instead of launching when the thread VM is still busy', async () => {
        // Thread already has a live foreign lease → occupied.
        mockDocs['vmSessions/project-1__chat-1'] = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({
                    activeLeaseOwner: 'someone-else-uuid',
                    activeCorrelationId: 'someone-else',
                    activeLeaseExpiresAt: Date.now() + 60_000,
                }),
            })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }

        const result = await startVmJob({
            objective: 'Follow-up while VM is busy',
            taskType: 'research',
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        expect(result.success).toBe(true)
        expect(result.status).toBe('queued')
        // No Cloud Run execution launched for a queued job…
        expect(mockQueueEnqueue).not.toHaveBeenCalled()
        // …but Gold is still reserved and the job record is written as 'queued'.
        expect(deductGold).toHaveBeenCalledTimes(1)
        expect(mockDocs['pendingWebhooks/correlation-1'].set).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'queued' })
        )
        // The cross-thread concurrency cap is skipped for a same-thread follow-up.
        expect(mockCollectionQuery.get).not.toHaveBeenCalled()
    })

    test('launchQueuedVmJob flips a queued job to pending and launches it', async () => {
        mockDocs['users/user-1'] = { get: jest.fn(async () => ({ exists: true, data: () => ({ gold: 500 }) })) }
        mockDocs['pendingWebhooks/queued-1'] = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({
                    kind: 'vm_job',
                    status: 'queued',
                    correlationId: 'queued-1',
                    projectId: 'project-1',
                    objectType: 'topics',
                    objectId: 'chat-1',
                    userId: 'user-1',
                    statusCommentId: 'status-comment-1',
                }),
            })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }

        const result = await launchQueuedVmJob('queued-1')

        expect(result).toEqual({ success: true, outcome: 'launched' })
        expect(mockDocs['pendingWebhooks/queued-1'].set).toHaveBeenCalledWith({ status: 'pending' }, { merge: true })
        expect(mockQueueEnqueue).toHaveBeenCalledWith('queued-1', { executionAttemptId: 'correlation-1' })
    })

    test('launchQueuedVmJob short-circuits and refunds when the user is out of Gold', async () => {
        const { refundGold } = require('../Gold/goldHelper')
        mockDocs['users/user-1'] = { get: jest.fn(async () => ({ exists: true, data: () => ({ gold: 3 }) })) }
        mockDocs['pendingWebhooks/queued-2'] = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({
                    kind: 'vm_job',
                    status: 'queued',
                    correlationId: 'queued-2',
                    projectId: 'project-1',
                    objectType: 'topics',
                    objectId: 'chat-1',
                    userId: 'user-1',
                    goldCharged: 20,
                    statusCommentId: 'status-comment-1',
                }),
            })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }

        const result = await launchQueuedVmJob('queued-2')

        expect(result).toEqual({ success: false, reason: 'insufficient_gold' })
        // Not launched — no Cloud Run execution, never flipped to 'pending'.
        expect(mockQueueEnqueue).not.toHaveBeenCalled()
        expect(mockDocs['pendingWebhooks/queued-2'].set).not.toHaveBeenCalledWith(
            { status: 'pending' },
            { merge: true }
        )
        // Base reserve refunded and the job settled as failed/insufficient_gold.
        expect(refundGold).toHaveBeenCalledWith(
            'user-1',
            20,
            expect.objectContaining({ source: 'vm_execution_refund' })
        )
        expect(mockDocs['pendingWebhooks/queued-2'].set).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed', failureReason: 'insufficient_gold' }),
            { merge: true }
        )
    })

    // AT-2196: a queued job skipped for Gold never runs, so nothing else would ever move its task.
    test('launchQueuedVmJob hands the skipped task to the user without moving its workflow step', async () => {
        mockDocs['users/user-1'] = { get: jest.fn(async () => ({ exists: true, data: () => ({ gold: 3 }) })) }
        mockDocs['items/project-1/tasks/task-1'] = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ currentReviewerId: 'assistant-1', stepHistory: [-1, 'ai-step'] }),
            })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }
        mockDocs['pendingWebhooks/queued-3'] = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({
                    kind: 'vm_job',
                    status: 'queued',
                    correlationId: 'queued-3',
                    projectId: 'project-1',
                    objectType: 'tasks',
                    objectId: 'task-1',
                    userId: 'user-1',
                    assistantId: 'assistant-1',
                    goldCharged: 20,
                    statusCommentId: 'status-comment-1',
                }),
            })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }

        await launchQueuedVmJob('queued-3')

        const [holdUpdate] = mockDocs['items/project-1/tasks/task-1'].set.mock.calls[0]
        expect(holdUpdate).toMatchObject({
            currentReviewerId: 'user-1',
            vmInteractionWorkflowStep: expect.objectContaining({
                reason: 'failure',
                failureReason: 'insufficient_gold',
                previousReviewerId: 'assistant-1',
                workflowStepId: 'ai-step',
            }),
        })
        expect(holdUpdate).toEqual(expect.not.objectContaining({ stepHistory: expect.anything() }))
    })

    test('launchQueuedVmJob is a no-op for a job cancelled while queued', async () => {
        mockDocs['pendingWebhooks/cancelled-1'] = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ kind: 'vm_job', status: 'cancelled' }),
            })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }

        const result = await launchQueuedVmJob('cancelled-1')

        expect(result).toEqual({ success: false, reason: 'settled', status: 'cancelled' })
        expect(mockQueueEnqueue).not.toHaveBeenCalled()
    })
})

describe('packageContextObjects', () => {
    const { packageContextObjects } = require('./vmJob').__private__
    const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
    const ATTACHMENT_TRIGGER = 'EbDsQTD14ahtSR5'

    beforeEach(() => {
        Object.keys(mockDocs).forEach(key => delete mockDocs[key])
        jest.clearAllMocks()
    })

    test('renders description media as readable text plus downloadable urls', async () => {
        const imageUrl = 'https://storage.example/mock.png'
        const description =
            `${IMAGE_TRIGGER}${imageUrl}${IMAGE_TRIGGER}https://storage.example/mock-small.png${IMAGE_TRIGGER}mock.png${IMAGE_TRIGGER}0\n` +
            'Build this screen.\n' +
            `${ATTACHMENT_TRIGGER}https://storage.example/spec.pdf${ATTACHMENT_TRIGGER}spec.pdf${ATTACHMENT_TRIGGER}false`

        mockDocs['items/project-1/tasks/task-1'] = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ extendedName: 'Build screen', description }),
            })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }

        const packaged = await packageContextObjects('project-1', ['task-1'])

        expect(packaged).not.toContain(IMAGE_TRIGGER)
        expect(packaged).not.toContain(ATTACHMENT_TRIGGER)
        expect(packaged).toContain('### task: Build screen')
        expect(packaged).toContain('mock.png\nBuild this screen.\nspec.pdf')
        expect(packaged).toContain('Files embedded in the task description (downloadable via the URLs):')
        expect(packaged).toContain(`- mock.png (image/png): ${imageUrl}`)
    })

    test('still reports an empty description', async () => {
        mockDocs['items/project-1/tasks/task-2'] = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ extendedName: 'Empty task', description: '' }),
            })),
            set: jest.fn(async () => {}),
            update: jest.fn(async () => {}),
        }

        const packaged = await packageContextObjects('project-1', ['task-2'])

        expect(packaged).toBe('### task: Empty task\n(no text description available)')
    })
})
