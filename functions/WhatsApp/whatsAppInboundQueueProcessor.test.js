jest.mock('firebase-admin', () => {
    const batchApi = {
        update: jest.fn(),
        delete: jest.fn(),
        commit: jest.fn(async () => {}),
    }

    return {
        firestore: jest.fn(() => ({
            batch: jest.fn(() => batchApi),
        })),
    }
})

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        sendWhatsAppMessage: jest.fn(async () => {}),
    }))
)

jest.mock('./whatsAppDailyTopic', () => ({
    getOrCreateWhatsAppDailyTopic: jest.fn(),
    storeUserMessageInTopic: jest.fn(),
}))

jest.mock('./whatsAppAssistantBridge', () => ({
    processWhatsAppAssistantMessage: jest.fn(),
}))

const { getOrCreateWhatsAppDailyTopic, storeUserMessageInTopic } = require('./whatsAppDailyTopic')
const { processWhatsAppAssistantMessage } = require('./whatsAppAssistantBridge')
const { processBatchForUser } = require('./whatsAppInboundQueueProcessor')

describe('WhatsApp inbound queue processor', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getOrCreateWhatsAppDailyTopic.mockResolvedValue({ chatId: 'chat-1' })
        storeUserMessageInTopic.mockResolvedValueOnce('comment-1').mockResolvedValueOnce('comment-2')
        processWhatsAppAssistantMessage.mockResolvedValue('Processed')
    })

    test('uses the last stored user message as the triggering WhatsApp message', async () => {
        await processBatchForUser('user-1', [
            {
                id: 'queue-1',
                createdAt: 1,
                fromNumber: 'whatsapp:+123',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageText: 'first',
                storedMessageText: 'first',
                processedMedia: [],
            },
            {
                id: 'queue-2',
                createdAt: 2,
                fromNumber: 'whatsapp:+123',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageText: 'second',
                storedMessageText: 'second',
                processedMedia: [],
            },
        ])

        expect(storeUserMessageInTopic).toHaveBeenCalledTimes(2)
        expect(processWhatsAppAssistantMessage).toHaveBeenCalledWith(
            'user-1',
            'project-1',
            'chat-1',
            'first\n\nsecond',
            'assistant-1',
            null,
            expect.objectContaining({
                skipCurrentMessageAppend: true,
                messageId: 'comment-2',
            })
        )
    })
})
