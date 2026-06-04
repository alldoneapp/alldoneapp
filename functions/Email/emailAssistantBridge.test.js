'use strict'

const mockAddBaseInstructions = jest.fn(async messages => {
    messages.push(['system', 'base instructions'])
})
const mockGetAssistantForChat = jest.fn()
const mockInteractWithChatStream = jest.fn()
const mockReduceGoldWhenChatWithAI = jest.fn().mockResolvedValue(undefined)
const mockExecuteToolNatively = jest.fn()

jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: mockAddBaseInstructions,
    buildConversationSafeToolResult: jest.fn((toolName, result) => result),
    buildPendingAttachmentPayload: jest.fn(() => null),
    executeToolNatively: mockExecuteToolNatively,
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
            displayName: 'Karsten Wysk',
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

    test('uses full history when the daily topic is isolated to the current participant set', async () => {
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
                isParticipantScopedTopic: true,
                skipCurrentMessageAppend: true,
            }
        )

        const messages = mockInteractWithChatStream.mock.calls[0][0]
        const systemText = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemText).toContain('only messages with the same participant set')
        expect(systemText).not.toContain('Do not use or mention any other earlier messages')
        expect(getLatestSafeEmailActionContext).not.toHaveBeenCalled()
        expect(getConversationHistory).toHaveBeenCalledWith('project-1', 'chat-1', 20, 120)
    })

    test('attributes calendar availability to the account owner instead of Anna', async () => {
        mockGetAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            displayName: 'Anna',
            allowedTools: ['find_calendar_availability'],
            instructions: '',
            model: 'MODEL_GPT5_5',
            temperature: 'TEMPERATURE_NORMAL',
        })
        mockExecuteToolNatively.mockResolvedValue({
            success: true,
            timeZone: 'Europe/Berlin',
            durationMinutes: 30,
            options: [
                {
                    start: '2026-06-05T09:00:00+02:00',
                    end: '2026-06-05T09:30:00+02:00',
                },
            ],
        })
        mockInteractWithChatStream
            .mockReturnValueOnce([
                {
                    additional_kwargs: {
                        tool_calls: [
                            {
                                id: 'tool-1',
                                function: {
                                    name: 'find_calendar_availability',
                                    arguments: JSON.stringify({
                                        timeMin: '2026-06-05T09:00:00+02:00',
                                        timeMax: '2026-06-05T17:00:00+02:00',
                                    }),
                                },
                            },
                        ],
                    },
                },
            ])
            .mockReturnValueOnce([{ content: 'Tomorrow I\u2019m free at 09:00. My calendar is otherwise busy.' }])

        const responseText = await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Please propose a meeting slot tomorrow',
            'assistant-1',
            {
                fromEmail: 'owner@example.com',
                toEmail: 'owner@example.com',
                toEmails: ['anna@alldoneapp.com'],
                ccEmails: ['guest@example.com'],
                hasAdditionalRecipients: true,
                isParticipantScopedTopic: true,
                skipCurrentMessageAppend: true,
            }
        )

        const initialMessages = mockInteractWithChatStream.mock.calls[0][0]
        const initialSystemText = initialMessages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')
        const finalMessages = mockInteractWithChatStream.mock.calls[1][0]
        const finalInstruction = finalMessages[finalMessages.length - 1].content

        expect(initialSystemText).toContain("Calendar tools operate on Karsten's connected calendars")
        expect(initialSystemText).toContain("Availability results represent Karsten's availability")
        expect(initialSystemText).toContain('explicitly attribute it to Karsten')
        expect(finalInstruction).toContain(
            "represents Karsten's availability across Karsten's connected calendars, not Anna's availability or calendar"
        )
        expect(finalInstruction).toContain('Attribute every free or available time to Karsten')
        expect(mockInteractWithChatStream.mock.calls[0][4]).toEqual(
            expect.objectContaining({
                calendarOwnerName: 'Karsten',
            })
        )
        expect(responseText).toBe("Tomorrow Karsten is free at 09:00. Karsten's calendar is otherwise busy.")
        expect(storeEmailAssistantMessageInTopic).toHaveBeenCalledWith(
            'project-1',
            'chat-1',
            'assistant-1',
            "Tomorrow Karsten is free at 09:00. Karsten's calendar is otherwise busy.",
            'user-1',
            expect.any(Object)
        )
    })

    test('rewrites first-person German calendar availability as the account owners availability', () => {
        expect(
            __private__.enforceCalendarOwnershipResponse(
                'Ich bin verfügbar. Meine Verfügbarkeit steht in meinem Kalender.',
                'Karsten'
            )
        ).toBe('Karsten ist verfügbar. Karstens Verfügbarkeit steht in Karstens Kalender.')
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
