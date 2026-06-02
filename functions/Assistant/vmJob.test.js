const mockDocs = {}
const mockQueueEnqueue = jest.fn(async () => {})
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

const crypto = require('crypto')
const { createInitialStatusMessage } = require('./assistantStatusHelper')
const { startVmJob } = require('./vmJob')

describe('startVmJob WhatsApp metadata', () => {
    beforeEach(() => {
        Object.keys(mockDocs).forEach(key => delete mockDocs[key])
        jest.clearAllMocks()
        jest.spyOn(crypto, 'randomUUID').mockReturnValue('correlation-1')
    })

    afterEach(() => {
        crypto.randomUUID.mockRestore()
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

        // No model/effort passed → the per-agent defaults (Codex: gpt-5.5 · high) are surfaced.
        expect(createInitialStatusMessage).toHaveBeenCalledWith(
            'project-1',
            'topics',
            'chat-1',
            'assistant-1',
            '🖥️ Spinning up Codex (gpt-5.5 · high effort) in a VM to work on this…',
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
        expect(result.message).toContain('VM task started with Codex')
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
            '🖥️ Spinning up Claude (sonnet · medium effort) in a VM to work on this…',
            expect.any(Array),
            expect.any(Array),
            expect.any(Array)
        )
    })
})
