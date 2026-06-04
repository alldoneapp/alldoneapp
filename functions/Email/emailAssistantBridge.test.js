'use strict'

const mockAddBaseInstructions = jest.fn(async messages => {
    messages.push(['system', 'base instructions'])
})
const mockGetAssistantForChat = jest.fn()
const mockInteractWithChatStream = jest.fn()
const mockReduceGoldWhenChatWithAI = jest.fn().mockResolvedValue(undefined)

jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: mockAddBaseInstructions,
    buildConversationSafeToolResult: jest.fn((toolName, result) => result),
    buildPendingAttachmentPayload: jest.fn(() => null),
    executeToolNatively: jest.fn(),
    getAssistantForChat: mockGetAssistantForChat,
    getMessageTextForTokenCounting: jest.fn(value => value),
    getToolResultFollowUpPrompt: jest.fn(() => 'Continue'),
    injectPendingAttachmentIntoToolArgs: jest.fn((toolName, toolArgs) => ({
        toolArgs,
        usedPendingAttachment: false,
    })),
    interactWithChatStream: mockInteractWithChatStream,
    isToolAllowedForExecution: jest.fn().mockResolvedValue(true),
    reduceGoldWhenChatWithAI: mockReduceGoldWhenChatWithAI,
    THREAD_CONTEXT_MESSAGE_LIMIT: 20,
}))

jest.mock('../Assistant/contextTimestampHelper', () => ({
    resolveUserTimezoneOffset: jest.fn(() => 120),
    resolveUserTimezoneName: jest.fn(() => 'Europe/Berlin'),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../WhatsApp/whatsAppToolErrorUtils', () => ({
    TASK_CREATION_FAILURE_MESSAGE: 'Task failed',
    getUserFacingToolErrorMessage: jest.fn(() => 'Tool failed'),
}))

jest.mock('./emailDailyTopic', () => ({
    getConversationHistory: jest.fn(),
    getLatestSafeEmailActionContext: jest.fn(),
    storeEmailAssistantMessageInTopic: jest.fn().mockResolvedValue('assistant-comment'),
}))

jest.mock(
    '@dqbd/tiktoken/lite',
    () => ({
        Tiktoken: jest.fn().mockImplementation(() => ({
            encode: jest.fn(() => []),
            free: jest.fn(),
        })),
    }),
    { virtual: true }
)

jest.mock(
    '@dqbd/tiktoken/encoders/cl100k_base.json',
    () => ({
        bpe_ranks: {},
        special_tokens: {},
        pat_str: '',
    }),
    { virtual: true }
)

const { getUserData } = require('../Users/usersFirestore')
const {
    getConversationHistory,
    getLatestSafeEmailActionContext,
    storeEmailAssistantMessageInTopic,
} = require('./emailDailyTopic')
const { __private__, processAnnaEmailAssistantMessage } = require('./emailAssistantBridge')

describe('emailAssistantBridge current recipient and safe follow-up context', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getUserData.mockResolvedValue({
            gold: 100,
            language: 'German',
        })
        mockGetAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            displayName: 'Anna',
            allowedTools: ['create_calendar_event'],
            instructions: '',
            model: 'MODEL_GPT5_5',
            temperature: 'TEMPERATURE_NORMAL',
        })
        getConversationHistory.mockResolvedValue([['user', 'Create the 13:30 meeting with the person in CC']])
        getLatestSafeEmailActionContext.mockResolvedValue({
            type: 'calendar_availability',
            timeZone: 'Europe/Berlin',
            durationMinutes: 30,
            options: [
                {
                    start: '2026-06-05T13:30:00+02:00',
                    end: '2026-06-05T14:00:00+02:00',
                },
            ],
        })
        mockInteractWithChatStream.mockReturnValue([{ content: 'Termin erstellt.' }])
    })

    test('supplies current CC addresses and only the prior privacy-safe availability context', async () => {
        await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Create the 13:30 meeting with the person in CC',
            'assistant-1',
            {
                fromEmail: 'owner@example.com',
                toEmail: 'owner@example.com',
                toEmails: ['anna@alldoneapp.com'],
                ccEmails: ['guest@example.com'],
                hasAdditionalRecipients: true,
                skipCurrentMessageAppend: true,
            }
        )

        const messages = mockInteractWithChatStream.mock.calls[0][0]
        const systemText = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemText).toContain('CC: ["guest@example.com"]')
        expect(systemText).not.toContain('anna@alldoneapp.com')
        expect(systemText).toContain('2026-06-05T13:30:00+02:00')
        expect(systemText).toContain('include the resolved address as an attendee')
        expect(systemText).toContain('Do not use or mention any other earlier messages')
        expect(getLatestSafeEmailActionContext).toHaveBeenCalledWith('project-1', 'chat-1', 'owner@example.com')
        expect(getConversationHistory).toHaveBeenCalledWith('project-1', 'chat-1', 1, 120)
        expect(storeEmailAssistantMessageInTopic).toHaveBeenCalledWith(
            'project-1',
            'chat-1',
            'assistant-1',
            'Termin erstellt.',
            'user-1',
            expect.objectContaining({
                safeActionContext: null,
            })
        )
    })

    test('builds a stripped availability context for a later recipient-safe follow-up', () => {
        expect(
            __private__.buildSafeActionContextFromToolResult(
                'find_calendar_availability',
                {
                    success: true,
                    timeZone: 'Europe/Berlin',
                    durationMinutes: 30,
                    options: [
                        {
                            start: '2026-06-05T13:30:00+02:00',
                            end: '2026-06-05T14:00:00+02:00',
                            privateTitle: 'Private meeting',
                        },
                    ],
                    calendarEmail: 'private@example.com',
                },
                123
            )
        ).toEqual({
            type: 'calendar_availability',
            timeZone: 'Europe/Berlin',
            durationMinutes: 30,
            options: [
                {
                    start: '2026-06-05T13:30:00+02:00',
                    end: '2026-06-05T14:00:00+02:00',
                },
            ],
            createdAt: 123,
        })
    })
})
