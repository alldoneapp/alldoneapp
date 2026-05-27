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
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { processBatchForUser, isTransientAssistantError } = require('./whatsAppInboundQueueProcessor')

describe('WhatsApp inbound queue processor', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getOrCreateWhatsAppDailyTopic.mockResolvedValue({ chatId: 'chat-1' })
        storeUserMessageInTopic.mockResolvedValue('comment-1')
        processWhatsAppAssistantMessage.mockResolvedValue('Processed')
    })

    test('uses the last stored user message as the triggering WhatsApp message', async () => {
        storeUserMessageInTopic.mockResolvedValueOnce('comment-1').mockResolvedValueOnce('comment-2')

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

        const whatsappService = TwilioWhatsAppService.mock.results[0].value
        expect(whatsappService.sendWhatsAppMessage).toHaveBeenCalledWith('whatsapp:+123', 'Processed', {
            projectId: 'project-1',
            objectId: 'chat-1',
            objectType: 'topics',
        })
    })

    test('retries transient assistant upstream errors before sending WhatsApp response', async () => {
        jest.spyOn(global, 'setTimeout').mockImplementation(callback => {
            callback()
            return { unref: jest.fn() }
        })

        processWhatsAppAssistantMessage
            .mockRejectedValueOnce(
                new Error(
                    '503 upstream connect error or disconnect/reset before headers. reset reason: connection termination'
                )
            )
            .mockResolvedValueOnce('Recovered')

        await processBatchForUser('user-1', [
            {
                id: 'queue-1',
                ref: { path: 'queue-1' },
                createdAt: 1,
                fromNumber: 'whatsapp:+123',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageText: 'retry me',
                storedMessageText: 'retry me',
                processedMedia: [],
            },
        ])

        expect(processWhatsAppAssistantMessage).toHaveBeenCalledTimes(2)

        const whatsappService = TwilioWhatsAppService.mock.results[0].value
        expect(whatsappService.sendWhatsAppMessage).toHaveBeenCalledWith('whatsapp:+123', 'Recovered', {
            projectId: 'project-1',
            objectId: 'chat-1',
            objectType: 'topics',
        })

        global.setTimeout.mockRestore()
    })

    test('does not retry non-transient assistant errors', async () => {
        processWhatsAppAssistantMessage.mockRejectedValueOnce(new Error('Invalid tool arguments'))

        await processBatchForUser('user-1', [
            {
                id: 'queue-1',
                ref: { path: 'queue-1' },
                createdAt: 1,
                fromNumber: 'whatsapp:+123',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                messageText: 'bad request',
                storedMessageText: 'bad request',
                processedMedia: [],
            },
        ])

        expect(processWhatsAppAssistantMessage).toHaveBeenCalledTimes(1)

        const whatsappService = TwilioWhatsAppService.mock.results[0].value
        expect(whatsappService.sendWhatsAppMessage).toHaveBeenCalledWith(
            'whatsapp:+123',
            'Sorry, I encountered an error. Please try again later.'
        )
    })

    test('classifies upstream connection resets as transient assistant errors', () => {
        expect(
            isTransientAssistantError(
                new Error(
                    '503 upstream connect error or disconnect/reset before headers. reset reason: connection termination'
                )
            )
        ).toBe(true)
        expect(isTransientAssistantError(Object.assign(new Error('temporarily unavailable'), { status: 503 }))).toBe(
            true
        )
        expect(isTransientAssistantError(new Error('Invalid tool arguments'))).toBe(false)
    })
})
