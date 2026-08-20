const mockInteractWithChatStream = jest.fn()
const mockStoreBotAnswerStream = jest.fn()
const mockAddBaseInstructions = jest.fn(async () => {})
const mockReduceGoldWhenChatWithAI = jest.fn(async () => {})
const mockGetCommonData = jest.fn()
const mockGetUserDataOptimized = jest.fn()
const mockGetOpenTasksContextMessage = jest.fn()
const mockGetOptimizedContextMessages = jest.fn()
const mockRemoveSingleChatNotification = jest.fn(async () => {})
const mockSendTaskCompletionNotification = jest.fn()
const mockSendWhatsAppMessageWithConversationLink = jest.fn()
const mockGetUserLocalDayBounds = jest.fn(() => ({ startOfDay: 100, endOfDay: 200 }))
const mockMirrorAssistantResultToWhatsAppDailyTopic = jest.fn(async () => ({ mirrored: true, reason: 'stored' }))
const mockCommentQueryWhere = jest.fn()
const mockCommentQueryGet = jest.fn(async () => mockBuildEmptyQuerySnapshot())

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
    getOptimizedContextMessages: (...args) => mockGetOptimizedContextMessages(...args),
    getMessageTextForTokenCounting: jest.fn(content => (typeof content === 'string' ? content : '')),
    extractImageUrlsFromMessageContent: jest.fn(() => []),
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

jest.mock('../WhatsApp/whatsAppResultMirror', () => ({
    mirrorAssistantResultToWhatsAppDailyTopic: (...args) => mockMirrorAssistantResultToWhatsAppDailyTopic(...args),
}))

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        sendTaskCompletionNotification: (...args) => mockSendTaskCompletionNotification(...args),
        sendWhatsAppMessageWithConversationLink: (...args) => mockSendWhatsAppMessageWithConversationLink(...args),
    }))
)

jest.mock('firebase-admin', () => {
    const docGet = jest.fn(async path => ({
        data: () =>
            path === 'users/user-1'
                ? { phone: '+1234567890', defaultProjectId: 'whatsapp-project', displayName: 'Karsten' }
                : {},
    }))

    const query = {
        where: jest.fn((...args) => {
            mockCommentQueryWhere(...args)
            return query
        }),
        orderBy: jest.fn(() => query),
        limit: jest.fn(() => query),
        get: jest.fn((...args) => mockCommentQueryGet(...args)),
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

const {
    generatePreConfigTaskResult,
    getLatestUserMessageOnUserLocalDay,
    hasUserMessageOnUserLocalDay,
    buildScheduledTaskSourceLabel,
} = require('./assistantPreConfigTaskTopic')

test('exports the local-day user-message lookup used by heartbeats', () => {
    expect(getLatestUserMessageOnUserLocalDay).toEqual(expect.any(Function))
    expect(hasUserMessageOnUserLocalDay).toEqual(expect.any(Function))
})

test('returns the latest user message position using timestamp and ID ordering', async () => {
    jest.clearAllMocks()
    mockCommentQueryGet
        .mockResolvedValueOnce({
            empty: false,
            docs: [{ id: 'message-a', data: () => ({ created: 350 }) }],
        })
        .mockResolvedValueOnce({
            empty: false,
            docs: [{ id: 'message-z', data: () => ({ created: 350 }) }],
        })

    await expect(getLatestUserMessageOnUserLocalDay('project-1', 'chat-1', 'user-1', {}, 350)).resolves.toEqual({
        createdAt: 350,
        commentId: 'message-z',
    })
})

test('daily-chat message lookup counts only user-authored messages inside the user local day', async () => {
    jest.clearAllMocks()
    mockGetUserLocalDayBounds.mockReturnValueOnce({ startOfDay: 300, endOfDay: 400 })

    await hasUserMessageOnUserLocalDay(
        'project-1',
        'Heartbeat20260505user-1',
        'user-1',
        {
            uid: 'user-1',
            timezone: 120,
        },
        350
    )

    expect(mockGetUserLocalDayBounds).toHaveBeenCalledWith(expect.objectContaining({ timezone: 120 }), 350)
    expect(mockCommentQueryWhere).toHaveBeenCalledWith('creatorId', '==', 'user-1')
    expect(mockCommentQueryWhere).toHaveBeenCalledWith('created', '>=', 300)
    expect(mockCommentQueryWhere).toHaveBeenCalledWith('created', '<=', 400)
})

describe('assistantPreConfigTaskTopic WhatsApp auto-read', () => {
    const aiSettings = {
        model: 'MODEL_GPT5_5',
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
        mockGetOptimizedContextMessages.mockResolvedValue([
            ['system', 'Canonical task context'],
            ['user', 'Execute this task in a VM'],
        ])
        mockInteractWithChatStream.mockResolvedValue({})
        mockGetCommonData.mockResolvedValue({
            project: { id: 'project-1', name: 'Project A' },
            chat: { title: 'Heartbeat' },
            chatLink: 'https://my.alldone.app/projects/project-1/chats/chat-1/chat',
        })
        mockStoreBotAnswerStream.mockImplementation(async (...args) => {
            const streamOutput = args[args.length - 2]
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

        expect(mockGetCommonData).toHaveBeenCalledWith('project-1', 'topics', 'chat-1')
        expect(mockGetUserLocalDayBounds).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'user-1' }),
            expect.any(Number)
        )
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

    test('does not send WhatsApp for heartbeat guardrail failures', async () => {
        mockStoreBotAnswerStream.mockImplementationOnce(async (...args) => {
            const streamOutput = args[args.length - 2]
            if (streamOutput && typeof streamOutput === 'object') {
                streamOutput.commentId = 'comment-1'
                streamOutput.guardrailStopped = {
                    reason: 'time_budget',
                    message:
                        '⚠️ Stopped: this run reached its time limit before finishing. Please narrow the request or try again.',
                }
            }
            return '⚠️ Stopped: this run reached its time limit before finishing. Please narrow the request or try again.'
        })

        const result = await generatePreConfigTaskResult(
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

        expect(mockSendTaskCompletionNotification).not.toHaveBeenCalled()
        expect(mockSendWhatsAppMessageWithConversationLink).not.toHaveBeenCalled()
        expect(mockRemoveSingleChatNotification).not.toHaveBeenCalled()
        expect(result.guardrailStopped).toEqual({
            reason: 'time_budget',
            message:
                '⚠️ Stopped: this run reached its time limit before finishing. Please narrow the request or try again.',
        })
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

    test('uses a 55-minute run wall-clock budget for assistant tasks', async () => {
        await generatePreConfigTaskResult(
            'user-1',
            'project-1',
            'chat-1',
            ['user-1'],
            ['PUBLIC'],
            'assistant-1',
            'Long-running recurring task',
            'en',
            aiSettings,
            { sendWhatsApp: false, name: 'Recurring task' },
            null,
            'tasks'
        )

        expect(mockStoreBotAnswerStream.mock.calls[0][18]).toEqual(
            expect.objectContaining({ maxRunWallClockMs: 55 * 60 * 1000 })
        )
    })

    test('uses canonical task context for a background VM-style predefined prompt', async () => {
        const canonicalContext = [
            [
                'system',
                'The current conversation is attached to the task below.\n' +
                    'Project: Alldone Product (ID: project-1)\n' +
                    'Task ID: task-1\n' +
                    'Task title: Fix task processor\n' +
                    'Task description: Show the resolved assistant avatar and run prompts in the background.\n' +
                    'Relevant task metadata: {"priority":"must_do","taskMetadata":{"source":"predefined"}}',
            ],
            ['user', 'Execute this task in a VM'],
        ]
        mockGetOptimizedContextMessages.mockResolvedValueOnce(canonicalContext)

        await generatePreConfigTaskResult(
            'user-1',
            'project-1',
            'task-1',
            ['user-1'],
            ['PUBLIC'],
            'assistant-1',
            'Execute this task in a VM',
            'en',
            aiSettings,
            { source: 'predefined' },
            null,
            'tasks',
            { triggerMessageId: 'message-1' }
        )

        expect(mockGetOptimizedContextMessages).toHaveBeenCalledWith(
            'message-1',
            'project-1',
            'tasks',
            'task-1',
            'en',
            'Anna',
            'Be helpful',
            [],
            null,
            'user-1',
            'assistant-1'
        )
        expect(mockInteractWithChatStream).toHaveBeenCalledWith(
            canonicalContext,
            'MODEL_GPT5_5',
            'TEMPERATURE_NORMAL',
            [],
            expect.objectContaining({
                projectId: 'project-1',
                objectType: 'tasks',
                objectId: 'task-1',
                messageId: 'message-1',
            })
        )
        expect(mockStoreBotAnswerStream.mock.calls[0][11]).toEqual({
            message: 'Execute this task in a VM',
            content: 'Execute this task in a VM',
            currentMessageImageUrls: [],
        })
    })

    // AT-2387: the answer is written into this task's own thread, but a WhatsApp
    // follow-up is answered out of the daily WhatsApp topic. Without the mirror the
    // user reads the result on their phone and the assistant has never seen it.
    describe('daily WhatsApp topic mirror (AT-2387)', () => {
        beforeEach(() => {
            // Default to a closed 24h window (template path). jest.clearAllMocks() does not
            // undo a mockResolvedValue, so each test has to state which path it exercises.
            mockCommentQueryGet.mockResolvedValue({ empty: true })
        })

        const runRecurringTask = () =>
            generatePreConfigTaskResult(
                'user-1',
                'project-1',
                'generated-task-1',
                ['user-1'],
                ['PUBLIC'],
                'assistant-1',
                'Summarize the market',
                'en',
                aiSettings,
                { sendWhatsApp: true, name: 'Daily Market Analysis', recurrence: 'every_day' },
                null,
                'tasks'
            )

        test('mirrors the result after a plain WhatsApp delivery', async () => {
            // A user message earlier today means the 24h window is open, so the plain path runs.
            mockCommentQueryGet.mockResolvedValue({
                empty: false,
                docs: [{ id: 'user-message', data: () => ({ created: 150 }) }],
            })
            mockSendWhatsAppMessageWithConversationLink.mockResolvedValue({ success: true })

            await runRecurringTask()

            expect(mockSendWhatsAppMessageWithConversationLink).toHaveBeenCalled()
            expect(mockMirrorAssistantResultToWhatsAppDailyTopic).toHaveBeenCalledWith({
                userId: 'user-1',
                assistantId: 'assistant-1',
                resultText: 'AI reply',
                sourceProjectId: 'project-1',
                sourceObjectId: 'generated-task-1',
                sourceObjectType: 'tasks',
                sourceLabel: 'From your recurring task "Daily Market Analysis"',
                sourceCommentId: 'comment-1',
                userData: expect.objectContaining({ uid: 'user-1', defaultProjectId: 'whatsapp-project' }),
            })
        })

        test('mirrors the result after a template WhatsApp delivery too', async () => {
            mockSendTaskCompletionNotification.mockResolvedValue({ success: true })

            await runRecurringTask()

            expect(mockSendTaskCompletionNotification).toHaveBeenCalled()
            expect(mockMirrorAssistantResultToWhatsAppDailyTopic).toHaveBeenCalledWith(
                expect.objectContaining({ resultText: 'AI reply', sourceObjectId: 'generated-task-1' })
            )
        })

        test('does not mirror when the WhatsApp delivery failed', async () => {
            mockSendTaskCompletionNotification.mockResolvedValue({ success: false })

            await runRecurringTask()

            expect(mockMirrorAssistantResultToWhatsAppDailyTopic).not.toHaveBeenCalled()
        })

        test('does not mirror when the task does not send WhatsApp at all', async () => {
            await generatePreConfigTaskResult(
                'user-1',
                'project-1',
                'generated-task-1',
                ['user-1'],
                ['PUBLIC'],
                'assistant-1',
                'Summarize the market',
                'en',
                aiSettings,
                { sendWhatsApp: false, name: 'Daily Market Analysis' },
                null,
                'tasks'
            )

            expect(mockMirrorAssistantResultToWhatsAppDailyTopic).not.toHaveBeenCalled()
        })

        test('passes the full user doc, not the gold/timezone-only optimized user', async () => {
            // getUserDataOptimized deliberately returns only gold + timezone fields, so the
            // mirror cannot resolve defaultProjectId from it.
            mockSendTaskCompletionNotification.mockResolvedValue({ success: true })

            await runRecurringTask()

            const { userData } = mockMirrorAssistantResultToWhatsAppDailyTopic.mock.calls[0][0]
            expect(userData.defaultProjectId).toBe('whatsapp-project')
        })

        test('names the task in the header so the daily topic says where the result came from', () => {
            expect(buildScheduledTaskSourceLabel({ name: 'Daily Market Analysis', recurrence: 'every_day' })).toBe(
                'From your recurring task "Daily Market Analysis"'
            )
            expect(buildScheduledTaskSourceLabel({ name: 'One-off research', recurrence: 'never' })).toBe(
                'From your assistant task "One-off research"'
            )
            // An unnamed task still gets a header; it just cannot name itself.
            expect(buildScheduledTaskSourceLabel({})).toBe('From your assistant task')
            expect(buildScheduledTaskSourceLabel(null)).toBe('From your assistant task')
        })

        test('a failing mirror never breaks the run', async () => {
            mockSendTaskCompletionNotification.mockResolvedValue({ success: true })
            mockMirrorAssistantResultToWhatsAppDailyTopic.mockRejectedValueOnce(new Error('firestore down'))

            const result = await runRecurringTask()

            expect(result.success).toBe(true)
        })
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
