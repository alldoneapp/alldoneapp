const mockSendWhatsAppMessageWithConversationLink = jest.fn()

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
            { artifactCount: 1, pendingRef }
        )

        expect(result.success).toBe(true)
        expect(mockSendWhatsAppMessageWithConversationLink).toHaveBeenCalledWith(
            'whatsapp:+123',
            'Final VM result\n\nGenerated file is attached in the Alldone thread.',
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

    test('uses raw output so internal attachment tokens are not sent to WhatsApp', () => {
        const finalTextWithToken =
            'Final VM result \n\n EbDsQTD14ahtSR5https://storage.example/fileEbDsQTD14ahtSR5file.pdfEbDsQTD14ahtSR5false'
        const whatsappMessage = __private__.buildWhatsAppVmResultMessage('Final VM result', { artifactCount: 1 })

        expect(finalTextWithToken).toContain('EbDsQTD14ahtSR5')
        expect(whatsappMessage).toBe('Final VM result\n\nGenerated file is attached in the Alldone thread.')
        expect(whatsappMessage).not.toContain('EbDsQTD14ahtSR5')
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
