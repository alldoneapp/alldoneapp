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

const { __private__ } = require('./TwilioWhatsAppService')

describe('TwilioWhatsAppService conversation links', () => {
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
})
