const mockInteractWithChatStream = jest.fn()
const mockStoreBotAnswerStream = jest.fn()
const mockAddBaseInstructions = jest.fn(async () => {})
const mockReduceGoldWhenChatWithAI = jest.fn(async () => {})
const mockGetCommonData = jest.fn()
const mockGetUserDataOptimized = jest.fn()
const mockGetOpenTasksContextMessage = jest.fn()
const mockRemoveSingleChatNotification = jest.fn(async () => {})
const mockSendTaskCompletionNotification = jest.fn()
const mockSendWhatsAppMessageWithConversationLink = jest.fn()
const mockGetUserLocalDayBounds = jest.fn(() => ({ startOfDay: 100, endOfDay: 200 }))
const mockCommentQueryWhere = jest.fn()

const mockBuildEmptyQuerySnapshot = () => ({ empty: true })

global.crypto = require('crypto').webcrypto

jest.mock('./assistantHelper', () => ({
    interactWithChatStream: (...args) => mockInteractWithChatStream(...args),
    storeBotAnswerStream: (...args) => mockStoreBotAnswerStream(...args),
    addBaseInstructions: (...args) => mockAddBaseInstructions(...args),
    parseTextForUseLiKePrompt: jest.fn(text => text),
    reduceGoldWhenChatWithAI: (...args) => mockReduceGoldWhenChatWithAI(...args),
    getTaskOrAssistantSettings: jest.fn(),
    getAssistantForChat: jest.fn(),
    getCommonData: (...args) => mockGetCommonData(...args),
    normalizeModelKey: jest.fn(model => model),
    getOpenTasksContextMessage: (...args) => mockGetOpenTasksContextMessage(...args),
}))

jest.mock('./firestoreOptimized', () => ({
    getUserDataOptimized: (...args) => mockGetUserDataOptimized(...args),
}))

jest.mock('./assistantStatusHelper', () => ({
    createInitialStatusMessage: jest.fn(),
}))

jest.mock('./contextTimestampHelper', () => ({
    resolveUserTimezoneOffset: jest.fn(() => null),
    getUserLocalDayBounds: (...args) => mockGetUserLocalDayBounds(...args),
}))

jest.mock('./noteContextHelper', () => ({
    fetchMentionedNotesContext: jest.fn(async () => ''),
}))

jest.mock('../Chats/chatsFirestoreCloud', () => ({
    removeSingleChatNotification: (...args) => mockRemoveSingleChatNotification(...args),
}))

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        sendTaskCompletionNotification: (...args) => mockSendTaskCompletionNotification(...args),
        sendWhatsAppMessageWithConversationLink: (...args) => mockSendWhatsAppMessageWithConversationLink(...args),
    }))
)

jest.mock('firebase-admin', () => {
    const docGet = jest.fn(async path => ({
        data: () => (path === 'users/user-1' ? { phone: '+1234567890' } : {}),
    }))

    const query = {
        where: jest.fn((...args) => {
            mockCommentQueryWhere(...args)
            return query
        }),
        orderBy: jest.fn(() => query),
        limit: jest.fn(() => query),
        get: jest.fn(async () => mockBuildEmptyQuerySnapshot()),
    }

    return {
        firestore: jest.fn(() => ({
            doc: jest.fn(path => ({
                get: jest.fn(async () => docGet(path)),
            })),
            collection: jest.fn(() => query),
        })),
    }
})

jest.mock(
    '@dqbd/tiktoken/lite',
    () => ({
        Tiktoken: jest.fn().mockImplementation(() => ({})),
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

const { generatePreConfigTaskResult } = require('./assistantPreConfigTaskTopic')

describe('assistantPreConfigTaskTopic WhatsApp auto-read', () => {
    const aiSettings = {
        model: 'MODEL_GPT5_4',
        temperature: 'TEMPERATURE_NORMAL',
        systemMessage: 'Be helpful',
        assistantDisplayName: 'Anna',
        assistantUid: 'assistant-1',
        allowedTools: [],
    }

    beforeEach(() => {
        jest.clearAllMocks()

        mockGetUserDataOptimized.mockResolvedValue({ gold: 10, uid: 'user-1' })
        mockGetOpenTasksContextMessage.mockResolvedValue(null)
        mockInteractWithChatStream.mockResolvedValue({})
        mockGetCommonData.mockResolvedValue({
            project: { id: 'project-1', name: 'Project A' },
            chat: { title: 'Heartbeat' },
            chatLink: 'https://my.alldone.app/projects/project-1/chats/chat-1/chat',
        })
        mockStoreBotAnswerStream.mockImplementation(async (...args) => {
            const streamOutput = args[args.length - 1]
            if (streamOutput && typeof streamOutput === 'object') {
                streamOutput.commentId = 'comment-1'
            }
            return 'AI reply'
        })
        mockReduceGoldWhenChatWithAI.mockResolvedValue(undefined)
        mockSendWhatsAppMessageWithConversationLink.mockResolvedValue({ success: true })
    })

    test('checks user messages within the current local day before deciding on a template send', async () => {
        mockSendTaskCompletionNotification.mockResolvedValue({ success: true })

        await generatePreConfigTaskResult(
            'user-1',
            'project-1',
            'chat-1',
            ['user-1'],
            ['PUBLIC'],
            'assistant-1',
            'Heartbeat prompt',
            'en',
            aiSettings,
            { sendWhatsApp: true, name: 'Heartbeat' },
            null,
            'topics'
        )

        expect(mockGetUserLocalDayBounds).toHaveBeenCalledWith(expect.objectContaining({ uid: 'user-1' }))
        expect(mockCommentQueryWhere).toHaveBeenCalledWith('created', '>=', 100)
        expect(mockCommentQueryWhere).toHaveBeenCalledWith('created', '<=', 200)
    })

    test('marks assistant message as read after successful direct WhatsApp delivery', async () => {
        mockSendTaskCompletionNotification.mockResolvedValue({ success: true })

        await generatePreConfigTaskResult(
            'user-1',
            'project-1',
            'chat-1',
            ['user-1'],
            ['PUBLIC'],
            'assistant-1',
            'Heartbeat prompt',
            'en',
            aiSettings,
            { sendWhatsApp: true, name: 'Heartbeat' },
            null,
            'topics'
        )

        expect(mockSendTaskCompletionNotification).toHaveBeenCalled()
        expect(mockRemoveSingleChatNotification).toHaveBeenCalledWith('project-1', 'user-1', 'comment-1')
    })

    test('keeps assistant message unread when direct WhatsApp delivery does not succeed', async () => {
        mockSendTaskCompletionNotification.mockResolvedValue({ success: false })

        await generatePreConfigTaskResult(
            'user-1',
            'project-1',
            'chat-1',
            ['user-1'],
            ['PUBLIC'],
            'assistant-1',
            'Heartbeat prompt',
            'en',
            aiSettings,
            { sendWhatsApp: true, name: 'Heartbeat' },
            null,
            'topics'
        )

        expect(mockRemoveSingleChatNotification).not.toHaveBeenCalled()
    })

    test('injects optional open tasks context before the prompt', async () => {
        mockGetOpenTasksContextMessage.mockResolvedValue({
            message: 'Today (including overdue) the user has 4 open tasks in total.',
            openTasksData: { projects: [{ name: 'Project A', openTaskCount: 4 }], totalCount: 4 },
        })

        await generatePreConfigTaskResult(
            'user-1',
            'project-1',
            'chat-1',
            ['user-1'],
            ['PUBLIC'],
            'assistant-1',
            'Heartbeat prompt',
            'en',
            aiSettings,
            { sendWhatsApp: false, name: 'Heartbeat' },
            null,
            'topics',
            { includeOpenTasksContext: true }
        )

        expect(mockGetOpenTasksContextMessage).toHaveBeenCalledWith('user-1', null)
        expect(mockInteractWithChatStream).toHaveBeenCalledWith(
            expect.arrayContaining([
                ['system', 'Today (including overdue) the user has 4 open tasks in total.'],
                ['user', 'Heartbeat prompt'],
            ]),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything()
        )
    })

    test('preserves additional assistant and user turns before the latest prompt', async () => {
        await generatePreConfigTaskResult(
            'user-1',
            'project-1',
            'chat-1',
            ['user-1'],
            ['PUBLIC'],
            'assistant-1',
            'Check in with the user',
            'en',
            aiSettings,
            { sendWhatsApp: false, name: 'Heartbeat' },
            null,
            'topics',
            {
                additionalContextMessages: [
                    ['assistant', '[Monday, April 13th 2026, 8:00:00 am]: Did you make progress?'],
                    ['user', '[Monday, April 13th 2026, 8:05:00 am]: Yes, partly.'],
                ],
            }
        )

        expect(mockInteractWithChatStream).toHaveBeenCalledWith(
            expect.arrayContaining([
                ['assistant', '[Monday, April 13th 2026, 8:00:00 am]: Did you make progress?'],
                ['user', '[Monday, April 13th 2026, 8:05:00 am]: Yes, partly.'],
                ['user', 'Check in with the user'],
            ]),
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything()
        )
    })
})
