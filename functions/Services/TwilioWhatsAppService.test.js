const mockMessagesCreate = jest.fn()

jest.mock('firebase-admin', () => ({
    app: jest.fn(() => ({
        options: {
            projectId: 'alldonealeph',
        },
    })),
}))

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: jest.fn(() => ({
        TWILIO_ACCOUNT_SID: 'sid',
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_WHATSAPP_FROM: 'whatsapp:+10000000000',
    })),
}))

jest.mock('twilio', () =>
    jest.fn(() => ({
        messages: {
            create: mockMessagesCreate,
        },
    }))
)

const TwilioWhatsAppService = require('./TwilioWhatsAppService')
const { __private__ } = TwilioWhatsAppService

describe('TwilioWhatsAppService conversation links', () => {
    beforeEach(() => {
        mockMessagesCreate.mockReset()
        mockMessagesCreate.mockResolvedValue({ sid: 'SM123', status: 'queued' })
    })

    test('builds task chat URLs for task notifications', () => {
        expect(__private__.buildConversationUrl('https://my.alldone.app', 'project-1', 'task-1', 'tasks')).toBe(
            'https://my.alldone.app/projects/project-1/tasks/task-1/chat'
        )
    })

    test('builds topic chat URLs for heartbeat notifications', () => {
        expect(
            __private__.buildConversationUrl('https://my.alldone.app', 'project-1', 'BotChat20260404user-1', 'topics')
        ).toBe('https://my.alldone.app/projects/project-1/chats/BotChat20260404user-1/chat')
    })

    test('defaults to task chat URLs when object type is omitted', () => {
        expect(__private__.buildConversationUrl('https://my.alldone.app', 'project-1', 'task-1')).toBe(
            'https://my.alldone.app/projects/project-1/tasks/task-1/chat'
        )
    })

    test('keeps plain messages unchanged when within safe limit', () => {
        const message = 'Short WhatsApp message'

        expect(
            __private__.truncateMessageWithConversationLink(
                message,
                'https://my.alldone.app/projects/project-1/chats/topic-1/chat'
            )
        ).toEqual({
            message,
            truncated: false,
        })
    })

    test('truncates long plain messages even without a conversation link', () => {
        const original = 'B'.repeat(__private__.MAX_PLAIN_WHATSAPP_MESSAGE_LENGTH + 50)
        const result = __private__.truncateMessageWithConversationLink(original)

        expect(result.truncated).toBe(true)
        expect(result.message.length).toBeLessThanOrEqual(__private__.MAX_PLAIN_WHATSAPP_MESSAGE_LENGTH)
        expect(result.message.endsWith('...')).toBe(true)
    })

    test('truncates long plain messages and appends a conversation link', () => {
        const original = 'A'.repeat(__private__.MAX_PLAIN_WHATSAPP_MESSAGE_LENGTH + 250)
        const conversationUrl = 'https://my.alldone.app/projects/project-1/chats/topic-1/chat'
        const result = __private__.truncateMessageWithConversationLink(original, conversationUrl)

        expect(result.truncated).toBe(true)
        expect(result.message.length).toBeLessThanOrEqual(__private__.MAX_PLAIN_WHATSAPP_MESSAGE_LENGTH)
        expect(result.message).toContain(`Read full message: ${conversationUrl}`)
        expect(result.message.endsWith(`Read full message: ${conversationUrl}`)).toBe(true)
    })

    test('converts internal mention tokens to plain names for WhatsApp', () => {
        expect(
            __private__.sanitizeTextForWhatsApp(
                'Please check @JohnM2mVOSjAVPPKweLDoe#user-1 and @JaneM2mVOSjAVPPKweLSmith#contact-1###avatar'
            )
        ).toBe('Please check John Doe and Jane Smith')
    })

    test('sends plain WhatsApp messages with display names instead of mention markup', async () => {
        const service = new TwilioWhatsAppService()

        const result = await service.sendWhatsAppMessage('+1234567890', 'Done for @JohnM2mVOSjAVPPKweLDoe#user-1.')

        expect(result.success).toBe(true)
        expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
        expect(mockMessagesCreate.mock.calls[0][0].body).toBe('Done for John Doe.')
    })
})

describe('TwilioWhatsAppService task completion template', () => {
    beforeEach(() => {
        mockMessagesCreate.mockReset()
        mockMessagesCreate.mockResolvedValue({ sid: 'SM123', status: 'queued' })
    })

    test('sends the first-message template with assistant name and sanitized result only', async () => {
        const service = new TwilioWhatsAppService()

        const result = await service.sendTaskCompletionNotification(
            '+1234567890',
            'user-1',
            'project-1',
            'task-1',
            'Anna',
            { name: 'Morning check-in' },
            `First line\n${'A'.repeat(350)}`
        )

        expect(result.success).toBe(true)
        expect(mockMessagesCreate).toHaveBeenCalledTimes(1)

        const payload = mockMessagesCreate.mock.calls[0][0]
        expect(payload.contentSid).toBe(__private__.TASK_COMPLETION_TEMPLATE_SID)
        expect(payload.from).toBe('whatsapp:+10000000000')
        expect(payload.to).toBe('whatsapp:+1234567890')

        const contentVariables = JSON.parse(payload.contentVariables)
        expect(Object.keys(contentVariables)).toEqual(['1', '2'])
        expect(contentVariables['1']).toBe('Anna')
        expect(contentVariables['2']).not.toContain('\n')
        expect(contentVariables['2'].length).toBeLessThanOrEqual(300)
    })

    test('sends template WhatsApp results with display names instead of mention markup', async () => {
        const service = new TwilioWhatsAppService()

        const result = await service.sendTaskCompletionNotification(
            '+1234567890',
            'user-1',
            'project-1',
            'task-1',
            'Anna',
            { name: 'Mention check' },
            'Task is assigned to @JohnM2mVOSjAVPPKweLDoe#user-1.'
        )

        expect(result.success).toBe(true)

        const payload = mockMessagesCreate.mock.calls[0][0]
        const contentVariables = JSON.parse(payload.contentVariables)
        expect(contentVariables['2']).toBe('Task is assigned to John Doe.')
    })
})
