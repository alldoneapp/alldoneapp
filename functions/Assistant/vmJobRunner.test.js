const mockSendWhatsAppMessageWithConversationLink = jest.fn()
const mockDeductGold = jest.fn()
const mockRefundGold = jest.fn()
const mockGetObjectFollowersIds = jest.fn()
const mockFirestore = jest.fn(() => ({
    doc: jest.fn(),
}))
mockFirestore.Timestamp = { now: jest.fn(() => ({ seconds: 123, nanoseconds: 0 })) }
mockFirestore.FieldValue = { increment: jest.fn(value => ({ __op: 'increment', value })) }

jest.mock('firebase-admin', () => ({
    firestore: mockFirestore,
}))

jest.mock('../Feeds/globalFeedsHelper', () => ({
    getObjectFollowersIds: mockGetObjectFollowersIds,
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY: 'allProjects',
    FEED_PUBLIC_FOR_ALL: 0,
    STAYWARD_COMMENT: 2,
    getBaseUrl: jest.fn(() => 'https://app.alldone.test'),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({})),
}))

jest.mock('./vmJob', () => ({
    VM_JOB_GOLD_SOURCE: 'vm_execution',
    VM_JOB_GOLD_REFUND_SOURCE: 'vm_execution_refund',
    VM_GOLD_PER_MINUTE: 1,
    VM_TOKENS_PER_GOLD: 100,
    getAgentLabel: jest.fn(agent => (agent === 'codex' ? 'Codex' : 'Claude')),
    formatAgentRunSuffix: (model, effort) => {
        const parts = []
        if (model) parts.push(model)
        if (effort) parts.push(`${effort} effort`)
        return parts.length ? ` (${parts.join(' · ')})` : ''
    },
    DEFAULT_CLAUDE_MODEL: 'opus',
    DEFAULT_CODEX_MODEL: 'gpt-5.5',
    DEFAULT_CLAUDE_EFFORT_LEVEL: 'high',
    DEFAULT_CODEX_REASONING_EFFORT: 'high',
}))

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        sendWhatsAppMessageWithConversationLink: mockSendWhatsAppMessageWithConversationLink,
    }))
)

jest.mock('../Gold/goldHelper', () => ({
    deductGold: mockDeductGold,
    refundGold: mockRefundGold,
}))

const { __private__ } = require('./vmJobRunner')

describe('VM runner prompt', () => {
    const baseVmJob = {
        taskType: 'prototype',
        objective: 'Check whether the repo needs a code change.',
    }

    test('tells text-only jobs not to create an output artifact', () => {
        const prompt = __private__.buildAgentPrompt({
            ...baseVmJob,
            taskType: 'research',
            objective: 'Answer in chat.',
        })

        expect(prompt).toContain('Do not create an output file just to return a normal text/chat answer')
        expect(prompt).toContain('Put the answer directly in your final message unless the user asked for a file')
    })

    test('only asks for a GitHub pull request when repository files changed', () => {
        const prompt = __private__.buildAgentPrompt(baseVmJob, {
            enabled: true,
            provider: 'github',
            baseBranch: 'main',
        })

        expect(prompt).toContain(
            'Only deliver the work as a GitHub Pull Request when you actually changed repository files'
        )
        expect(prompt).toContain('If there is no repository diff, do NOT commit, push, or open a Pull/Merge Request')
        expect(prompt).toContain(
            'If you made no repository changes, your final message MUST say that no Pull Request was opened'
        )
        expect(prompt).toContain('Repository dependencies are intentionally NOT installed before you start')
        expect(prompt).toContain(
            'when the requested change or a necessary lint/test/build verification actually requires them'
        )
        expect(prompt).toContain(
            'For explanation-only work or when no code change is needed, do not install dependencies'
        )
        expect(prompt).not.toContain('runner has already performed a best-effort dependency install')
        expect(prompt).toContain('retry before reporting failure')
    })

    test('only asks for a GitLab merge request when repository files changed', () => {
        const prompt = __private__.buildAgentPrompt(baseVmJob, {
            enabled: true,
            provider: 'gitlab',
            baseBranch: 'main',
        })

        expect(prompt).toContain(
            'Only deliver the work as a GitLab Merge Request when you actually changed repository files'
        )
        expect(prompt).toContain('If there is no repository diff, do NOT commit, push, or open a Pull/Merge Request')
        expect(prompt).toContain(
            'If you made no repository changes, your final message MUST say that no Merge Request was opened'
        )
    })

    test('renders live activity with the selected VM agent', () => {
        expect(__private__.renderVmWorkingHeader('Codex')).toBe('🖥️ Working with Codex in a VM…')
        expect(__private__.renderActivityLog(['💻 npm run lint'], 'Claude')).toContain(
            '🖥️ Working with Claude in a VM…'
        )
    })

    test('header includes the model and effort the agent is running with', () => {
        expect(__private__.renderVmWorkingHeader('Claude', { model: 'opus', effort: 'high' })).toBe(
            '🖥️ Working with Claude (opus · high effort) in a VM…'
        )
        expect(
            __private__.renderActivityLog(['💻 npm run lint'], 'Codex', { model: 'gpt-5.5', effort: 'medium' })
        ).toBe('🖥️ Working with Codex (gpt-5.5 · medium effort) in a VM…\n\n💻 npm run lint')
    })

    test('header omits the suffix when neither model nor effort is known', () => {
        expect(__private__.renderVmWorkingHeader('Claude', { model: '', effort: '' })).toBe(
            '🖥️ Working with Claude in a VM…'
        )
    })

    test('resolveAgentRunDetails falls back to per-agent defaults when the job omits them', () => {
        expect(__private__.resolveAgentRunDetails({ agent: 'claude' })).toEqual({ model: 'opus', effort: 'high' })
        expect(__private__.resolveAgentRunDetails({ agent: 'codex' })).toEqual({ model: 'gpt-5.5', effort: 'high' })
    })

    test('resolveAgentRunDetails uses explicit job values when present', () => {
        expect(
            __private__.resolveAgentRunDetails({ agent: 'codex', agentModel: 'gpt-5.4', agentReasoningEffort: 'low' })
        ).toEqual({ model: 'gpt-5.4', effort: 'low' })
    })
})

describe('Codex VM proxy configuration', () => {
    test('routes Codex through the HTTP proxy and disables Responses WebSockets', () => {
        const overrides = __private__.buildCodexProxyConfigOverrides('https://vm-proxy.example/functions/vmLlmProxy/')

        expect(overrides).toEqual(
            expect.arrayContaining([
                'model_provider="alldone_vm_proxy"',
                'model_providers.alldone_vm_proxy.base_url="https://vm-proxy.example/functions/vmLlmProxy/openai/v1"',
                'model_providers.alldone_vm_proxy.env_key="OPENAI_API_KEY"',
                'model_providers.alldone_vm_proxy.wire_api="responses"',
                'model_providers.alldone_vm_proxy.supports_websockets=false',
            ])
        )
    })

    test('includes the HTTP-only provider on fresh and resumed Codex runs', () => {
        for (const isResume of [false, true]) {
            const command = __private__.buildCodexRunCommand(
                isResume,
                'gpt-5.5',
                'high',
                'https://vm-proxy.example/vmLlmProxy'
            )

            expect(command).toContain(`-c 'model_provider="alldone_vm_proxy"'`)
            expect(command).toContain(
                `-c 'model_providers.alldone_vm_proxy.base_url="https://vm-proxy.example/vmLlmProxy/openai/v1"'`
            )
            expect(command).toContain(`-c 'model_providers.alldone_vm_proxy.supports_websockets=false'`)
            expect(command).toContain(`-c 'sandbox_mode="workspace-write"'`)
            expect(command).not.toContain('--sandbox')
        }
    })

    test('rejects malformed proxy URLs instead of allowing a direct Codex request', () => {
        expect(() => __private__.buildCodexProxyConfigOverrides('')).toThrow('Codex VM proxy base URL is invalid.')
        expect(() => __private__.buildCodexProxyConfigOverrides('file:///tmp/proxy')).toThrow(
            'Codex VM proxy base URL must use HTTP or HTTPS.'
        )
    })
})

describe('VM runner runtime Gold monitor', () => {
    const pendingWebhook = {
        correlationId: 'correlation-1',
        userId: 'user-1',
        goldCharged: 2,
        projectId: 'project-1',
        objectType: 'topics',
        objectId: 'chat-1',
    }
    const vmJob = { agent: 'claude' }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('deducts newly accrued runtime Gold while balance remains positive', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        const commandHandle = { kill: jest.fn(async () => true) }
        mockDeductGold.mockResolvedValue({ success: true, amount: 1, newBalance: 4 })

        const charged = await __private__.checkAndChargeVmRuntimeGold({
            pendingWebhook,
            pendingRef,
            commandHandle,
            runStartMs: 0,
            runtimeGoldCharged: 0,
            vmJob,
            now: () => 60000,
            getCurrentGold: jest.fn(async () => 5),
        })

        expect(charged).toBe(1)
        expect(mockDeductGold).toHaveBeenCalledWith(
            'user-1',
            1,
            expect.objectContaining({
                source: 'vm_execution',
                projectId: 'project-1',
                objectId: 'chat-1',
            })
        )
        expect(pendingRef.update).toHaveBeenCalledWith({ runtimeGoldCharged: 1 })
        expect(commandHandle.kill).not.toHaveBeenCalled()
    })

    test('kills the command when balance is already zero', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        const commandHandle = { kill: jest.fn(async () => true) }

        await expect(
            __private__.checkAndChargeVmRuntimeGold({
                pendingWebhook,
                pendingRef,
                commandHandle,
                runStartMs: 0,
                runtimeGoldCharged: 0,
                vmJob,
                now: () => 60000,
                getCurrentGold: jest.fn(async () => 0),
            })
        ).rejects.toMatchObject({ code: 'insufficient_gold', runtimeGoldCharged: 0 })

        expect(mockDeductGold).not.toHaveBeenCalled()
        expect(commandHandle.kill).toHaveBeenCalled()
    })

    test('deducts remaining positive balance and then kills when charge cannot be fully paid', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        const commandHandle = { kill: jest.fn(async () => true) }
        mockDeductGold.mockResolvedValue({ success: true, amount: 1, newBalance: 0 })

        await expect(
            __private__.checkAndChargeVmRuntimeGold({
                pendingWebhook,
                pendingRef,
                commandHandle,
                runStartMs: 0,
                runtimeGoldCharged: 0,
                vmJob,
                now: () => 120000,
                getCurrentGold: jest.fn(async () => 1),
            })
        ).rejects.toMatchObject({ code: 'insufficient_gold', runtimeGoldCharged: 1 })

        expect(mockDeductGold).toHaveBeenCalledWith('user-1', 1, expect.any(Object))
        expect(pendingRef.update).toHaveBeenCalledWith({ runtimeGoldCharged: 1 })
        expect(commandHandle.kill).toHaveBeenCalled()
    })

    test('completion top-up excludes runtime Gold already charged by the monitor', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 125000,
            usage: { totalTokens: 250 },
            runtimeGoldCharged: 2,
        })

        expect(charges).toEqual(
            expect.objectContaining({
                minutes: 3,
                runtimeGoldRemaining: 1,
                tokenGold: 3,
                topup: 4,
            })
        )
    })

    test('completion top-up excludes token Gold already charged by the proxy', () => {
        const charges = __private__.calculateCompletionGoldCharges({
            runtimeMs: 61000,
            usage: { totalTokens: 350 },
            runtimeGoldCharged: 1,
            proxyTokenGoldCharged: 2,
        })

        expect(charges).toEqual(
            expect.objectContaining({
                minutes: 2,
                runtimeGoldRemaining: 1,
                proxyTokenGoldCharged: 2,
                tokenGoldTotal: 4,
                tokenGold: 2,
                topup: 3,
            })
        )
    })

    test('technical failure refund includes base reserve plus runtime Gold already charged', async () => {
        mockRefundGold.mockResolvedValue({ success: true, amount: 5 })

        await __private__.refundVmJob(pendingWebhook, 'VM task failed during execution', 3)

        expect(mockRefundGold).toHaveBeenCalledWith(
            'user-1',
            5,
            expect.objectContaining({
                source: 'vm_execution_refund',
                note: 'VM task failed during execution',
            })
        )
    })
})

describe('VM runner cancellation monitor', () => {
    test('kills the active command and rejects when cancellation is requested', async () => {
        const pendingRef = {
            get: jest.fn(async () => ({
                exists: true,
                data: () => ({ status: 'cancel_requested' }),
            })),
        }
        const commandHandle = { kill: jest.fn(async () => true) }

        const monitor = __private__.startVmCancellationMonitor({
            pendingRef,
            commandHandle,
            getRuntimeGoldCharged: () => 3,
            intervalMs: 60000,
            correlationId: 'correlation-1',
        })

        await expect(monitor.promise).rejects.toMatchObject({
            code: 'vm_job_cancelled',
            runtimeGoldCharged: 3,
        })
        expect(commandHandle.kill).toHaveBeenCalled()
        monitor.stop()
    })

    test('detects cancellation status from pending webhook data', async () => {
        await expect(
            __private__.isVmJobCancellationRequested({
                get: jest.fn(async () => ({
                    exists: true,
                    data: () => ({ status: 'cancel_requested' }),
                })),
            })
        ).resolves.toBe(true)
    })
})

describe('VM runner artifact presentation', () => {
    test('places generated artifact links before the VM answer', () => {
        const finalText = __private__.buildVmFinalCommentText('Here is the summary.', [
            {
                fileName: 'report draft.pdf',
                storageUrl: 'https://storage.example/report.pdf',
            },
        ])

        expect(finalText).toBe(
            'EbDsQTD14ahtSR5https://storage.example/report.pdfEbDsQTD14ahtSR5report_draft.pdfEbDsQTD14ahtSR5false\n\nHere is the summary.'
        )
    })

    test('leaves text-only VM answers unchanged', () => {
        expect(__private__.buildVmFinalCommentText('Here is the summary.', [])).toBe('Here is the summary.')
    })
})

describe('VM completion chat metadata', () => {
    const createFirestoreMock = ({ commentData = {}, chatData = {} } = {}) => {
        const refs = new Map()
        const doc = jest.fn(path => {
            if (!refs.has(path)) refs.set(path, { path })
            return refs.get(path)
        })
        const transaction = {
            get: jest.fn(async ref => {
                if (ref.path.includes('/comments/comment-1')) {
                    return { exists: true, data: () => commentData }
                }
                if (ref.path === 'chatObjects/project-1/chats/task-1') {
                    return { exists: true, data: () => ({ title: 'Important task', members: ['user-2'], ...chatData }) }
                }
                if (ref.path === 'items/project-1/tasks/task-1') {
                    return { exists: true, data: () => ({ commentsData: { amount: 1 } }) }
                }
                if (ref.path === 'projects/project-1') {
                    return { exists: true, data: () => ({ name: 'Product' }) }
                }
                if (ref.path === 'assistants/project-1/items/assistant-1') {
                    return { exists: true, data: () => ({ displayName: 'Anna' }) }
                }
                return { exists: false, data: () => ({}) }
            }),
            set: jest.fn(),
            update: jest.fn(),
        }
        const runTransaction = jest.fn(async callback => callback(transaction))
        mockFirestore.mockReturnValue({ doc, runTransaction })
        return { doc, runTransaction, transaction, refs }
    }

    beforeEach(() => {
        jest.clearAllMocks()
        mockFirestore.FieldValue.increment.mockImplementation(value => ({ __op: 'increment', value }))
        mockGetObjectFollowersIds.mockResolvedValue(['user-1', 'user-2'])
    })

    test('applies the same unread and task metadata as a normal assistant message', async () => {
        const { transaction, refs } = createFirestoreMock()

        const result = await __private__.applyVmCompletionMetadata(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
            },
            'comment-1',
            'Finished VM result'
        )

        expect(result.applied).toBe(true)
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('chatObjects/project-1/chats/task-1'),
            expect.objectContaining({
                members: ['user-2', 'user-1', 'assistant-1'],
                lastEditorId: 'assistant-1',
                lastAssistantComment: expect.any(Number),
                'commentsData.lastCommentOwnerId': 'assistant-1',
                'commentsData.lastComment': 'Finished VM result',
                'commentsData.lastCommentType': 2,
                'commentsData.amount': { __op: 'increment', value: 1 },
            }),
            { merge: true }
        )
        expect(transaction.update).toHaveBeenCalledWith(
            refs.get('items/project-1/tasks/task-1'),
            expect.objectContaining({
                'commentsData.lastComment': expect.any(String),
                'commentsData.lastCommentType': 2,
                'commentsData.amount': { __op: 'increment', value: 1 },
            })
        )
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('chatNotifications/project-1/user-1/comment-1'),
            expect.objectContaining({
                chatId: 'task-1',
                chatType: 'tasks',
                followed: true,
                creatorId: 'assistant-1',
                creatorType: 'assistant',
            })
        )
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('users/user-1'),
            expect.objectContaining({
                'lastAssistantCommentData.project-1': expect.objectContaining({
                    objectType: 'tasks',
                    objectId: 'task-1',
                    creatorId: 'assistant-1',
                    creatorType: 'assistant',
                }),
                'lastAssistantCommentData.allProjects': expect.objectContaining({
                    projectId: 'project-1',
                    objectId: 'task-1',
                }),
            }),
            { merge: true }
        )
        expect(transaction.set).toHaveBeenCalledWith(
            refs.get('pushNotifications/comment-1'),
            expect.objectContaining({
                userIds: ['user-1', 'user-2'],
                chatId: 'task-1',
                projectId: 'project-1',
                type: 'Chat Notification',
            })
        )
    })

    test('does not double-apply metadata when the VM finalizer is retried', async () => {
        const { transaction } = createFirestoreMock({
            commentData: { vmCompletionMetadataAppliedAt: 123 },
        })

        const result = await __private__.applyVmCompletionMetadata(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                assistantId: 'assistant-1',
                userId: 'user-1',
                userIdsToNotify: ['user-1'],
                isPublicFor: [0],
            },
            'comment-1',
            'Finished VM result'
        )

        expect(result).toEqual({ applied: false, reason: 'already-applied' })
        expect(transaction.set).not.toHaveBeenCalled()
        expect(transaction.update).not.toHaveBeenCalled()
    })
})

describe('VM runner WhatsApp notifications', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockSendWhatsAppMessageWithConversationLink.mockResolvedValue({
            success: true,
            sid: 'SM123',
            status: 'queued',
        })
    })

    test('sends final output for WhatsApp-originated VM jobs', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }

        const result = await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
            },
            'Final VM result',
            {
                mediaContext: [{ fileName: 'report.pdf', storageUrl: 'https://storage.example/report.pdf' }],
                pendingRef,
            }
        )

        expect(result.success).toBe(true)
        expect(mockSendWhatsAppMessageWithConversationLink).toHaveBeenCalledWith(
            'whatsapp:+123',
            'Generated file:\nreport.pdf: https://storage.example/report.pdf\n\nFinal VM result',
            {
                projectId: 'project-1',
                objectId: 'chat-1',
                objectType: 'topics',
            }
        )
        expect(pendingRef.update).toHaveBeenCalledWith(
            expect.objectContaining({
                whatsappNotification: expect.objectContaining({
                    type: 'completed',
                    success: true,
                    sid: 'SM123',
                }),
            })
        )
    })

    test('does not send for app-originated VM jobs', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }

        const result = await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
            },
            'Final VM result',
            { pendingRef }
        )

        expect(result).toBeNull()
        expect(mockSendWhatsAppMessageWithConversationLink).not.toHaveBeenCalled()
        expect(pendingRef.update).not.toHaveBeenCalled()
    })

    test('sends the public artifact link, not the internal chat attachment token', () => {
        const finalTextWithToken =
            'Final VM result \n\n EbDsQTD14ahtSR5https://storage.example/fileEbDsQTD14ahtSR5file.pdfEbDsQTD14ahtSR5false'
        const whatsappMessage = __private__.buildWhatsAppVmResultMessage('Final VM result', {
            mediaContext: [{ fileName: 'file.pdf', storageUrl: 'https://storage.example/file.pdf' }],
        })

        expect(finalTextWithToken).toContain('EbDsQTD14ahtSR5')
        expect(whatsappMessage).toBe('Generated file:\nfile.pdf: https://storage.example/file.pdf\n\nFinal VM result')
        expect(whatsappMessage).not.toContain('EbDsQTD14ahtSR5')
    })

    test('lists every artifact download link before the answer', () => {
        const whatsappMessage = __private__.buildWhatsAppVmResultMessage('Done', {
            mediaContext: [
                { fileName: 'a.pdf', storageUrl: 'https://storage.example/a' },
                { fileName: 'b.csv', storageUrl: 'https://storage.example/b' },
            ],
        })

        expect(whatsappMessage).toBe(
            'Generated files:\na.pdf: https://storage.example/a\nb.csv: https://storage.example/b\n\nDone'
        )
    })

    test('leads with the artifact link so it survives WhatsApp tail truncation', () => {
        const longAnswer = 'x'.repeat(2000)
        const whatsappMessage = __private__.buildWhatsAppVmResultMessage(longAnswer, {
            mediaContext: [{ fileName: 'big.pdf', storageUrl: 'https://storage.example/big.pdf' }],
        })

        // Link is at the very top; the service trims the answer tail (never the leading link).
        expect(whatsappMessage.startsWith('Generated file:\nbig.pdf: https://storage.example/big.pdf')).toBe(true)
    })

    test('falls back to the plain answer when there are no artifacts', () => {
        expect(__private__.buildWhatsAppVmResultMessage('Just a text answer', {})).toBe('Just a text answer')
        expect(__private__.buildWhatsAppVmResultMessage('Just a text answer', { mediaContext: [] })).toBe(
            'Just a text answer'
        )
    })

    test('sends failure text for WhatsApp-originated VM jobs', async () => {
        await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
            },
            '❌ The VM task could not be completed: timeout',
            { notificationType: 'failed' }
        )

        expect(mockSendWhatsAppMessageWithConversationLink).toHaveBeenCalledWith(
            'whatsapp:+123',
            '❌ The VM task could not be completed: timeout',
            expect.any(Object)
        )
    })

    test('records Twilio failure without throwing', async () => {
        const pendingRef = { update: jest.fn(async () => {}) }
        mockSendWhatsAppMessageWithConversationLink.mockResolvedValueOnce({
            success: false,
            error: 'Twilio rejected the message',
        })

        const result = await __private__.sendWhatsAppVmResultNotification(
            {
                correlationId: 'correlation-1',
                triggerChannel: 'whatsapp',
                whatsappTo: 'whatsapp:+123',
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
            },
            'Final VM result',
            { pendingRef }
        )

        expect(result.success).toBe(false)
        expect(result.error).toBe('Twilio rejected the message')
        expect(pendingRef.update).toHaveBeenCalledWith(
            expect.objectContaining({
                whatsappNotification: expect.objectContaining({
                    success: false,
                    error: 'Twilio rejected the message',
                }),
            })
        )
    })
})
