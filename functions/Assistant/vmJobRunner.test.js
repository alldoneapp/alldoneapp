const mockSendWhatsAppMessageWithConversationLink = jest.fn()
const mockDeductGold = jest.fn()
const mockRefundGold = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: jest.fn(),
    })),
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
        expect(prompt).toContain('best-effort dependency install for JavaScript/TypeScript repos')
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
