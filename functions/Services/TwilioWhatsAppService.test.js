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
})
