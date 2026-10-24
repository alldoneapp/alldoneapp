jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => ({})) }))
jest.mock('../Assistant/assistantHelper', () => ({
    interactWithChatStream: jest.fn(),
    getAssistantForChat: jest.fn(),
    THREAD_CONTEXT_MESSAGE_LIMIT: 20,
    loadAssistantThreadState: jest.fn(async () => null),
    buildCompactThreadContextMessage: jest.fn(state => state?.summary || ''),
    addBaseInstructions: jest.fn(async () => {}),
    reduceGoldWhenChatWithAI: jest.fn(),
    executeToolNatively: jest.fn(),
    getToolResultFollowUpPrompt: jest.fn(() => 'Based on the tool results above, provide your response.'),
    getMessageTextForTokenCounting: jest.fn(content =>
        typeof content === 'string' ? content : JSON.stringify(content)
    ),
    isToolAllowedForExecution: jest.fn(async () => true),
    buildConversationSafeToolResult: jest.fn((toolName, toolResult) => {
        if (
            ['get_chat_attachment', 'get_gmail_attachment'].includes(toolName) &&
            toolResult?.success &&
            typeof toolResult?.fileBase64 === 'string' &&
            toolResult.fileBase64.trim()
        ) {
            return {
                ...toolResult,
                fileBase64: '[omitted from conversation; preserved for the next external tool call]',
                fileBase64Length: toolResult.fileBase64.length,
            }
        }
        return toolResult
    }),
    buildPendingAttachmentPayload: jest.fn((toolName, toolResult) => {
        if (
            !['get_chat_attachment', 'get_gmail_attachment'].includes(toolName) ||
            !toolResult?.success ||
            typeof toolResult?.fileBase64 !== 'string' ||
            !toolResult.fileBase64.trim()
        ) {
            return null
        }

        return {
            fileName: toolResult.fileName || '',
            fileBase64: toolResult.fileBase64 || '',
            fileMimeType: toolResult.fileMimeType || '',
            fileSizeBytes: toolResult.fileSizeBytes || 0,
            source: toolResult.source || (toolName === 'get_gmail_attachment' ? 'gmail' : 'chat'),
            messageId: toolResult.messageId || '',
        }
    }),
    buildConversationSafeToolArgs: jest.fn((toolName, toolArgs, pendingAttachmentPayload) => {
        if (!String(toolName || '').startsWith('external_tool_') || !toolArgs || typeof toolArgs !== 'object') {
            return toolArgs
        }

        const normalizedArgs = { ...toolArgs }
        if (
            typeof normalizedArgs.fileBase64 === 'string' &&
            normalizedArgs.fileBase64 &&
            (normalizedArgs.fileBase64 === pendingAttachmentPayload?.fileBase64 ||
                /^[A-Za-z0-9+/]+={0,2}$/.test(normalizedArgs.fileBase64))
        ) {
            normalizedArgs.fileBase64 = '[omitted from conversation; preserved for the next external tool call]'
            normalizedArgs.fileBase64Length = toolArgs.fileBase64.length
        }

        return normalizedArgs
    }),
    injectPendingAttachmentIntoToolArgs: jest.fn((toolName, toolArgs, pendingAttachmentPayload) => {
        if (!String(toolName || '').startsWith('external_tool_') || !pendingAttachmentPayload) {
            return { toolArgs, usedPendingAttachment: false }
        }

        const normalizedArgs = { ...(toolArgs || {}) }
        let usedPendingAttachment = false

        if (!normalizedArgs.fileBase64) {
            normalizedArgs.fileBase64 = pendingAttachmentPayload.fileBase64
            usedPendingAttachment = true
        }
        if (!normalizedArgs.fileName) {
            normalizedArgs.fileName = pendingAttachmentPayload.fileName
            usedPendingAttachment = true
        }
        if (!normalizedArgs.fileMimeType) normalizedArgs.fileMimeType = pendingAttachmentPayload.fileMimeType
        if (!normalizedArgs.fileSizeBytes) normalizedArgs.fileSizeBytes = pendingAttachmentPayload.fileSizeBytes
        if (!normalizedArgs.source) normalizedArgs.source = pendingAttachmentPayload.source

        return { toolArgs: normalizedArgs, usedPendingAttachment }
    }),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('./whatsAppDailyTopic', () => ({
    getConversationHistory: jest.fn(),
    storeAssistantMessageInTopic: jest.fn(),
}))

jest.mock('../Assistant/automaticThreadCompaction', () => ({
    runAutomaticThreadCompaction: jest.fn(async () => ({ compacted: false, hard: false, reason: 'below_threshold' })),
}))
jest.mock('./whatsAppHistoryContext', () => ({ loadWhatsAppHistoryContext: jest.fn(async () => '') }))
jest.mock('../Assistant/assistantActivityContext', () => ({ loadAssistantActivityContext: jest.fn(async () => '') }))

const { runAutomaticThreadCompaction } = require('../Assistant/automaticThreadCompaction')
const { loadWhatsAppHistoryContext } = require('./whatsAppHistoryContext')
const { loadAssistantActivityContext } = require('../Assistant/assistantActivityContext')

const assistantHelper = require('../Assistant/assistantHelper')
const { getUserData } = require('../Users/usersFirestore')
const { getConversationHistory, storeAssistantMessageInTopic } = require('./whatsAppDailyTopic')
const { processWhatsAppAssistantMessage, collectStreamWithToolCalls } = require('./whatsAppAssistantBridge')
const { createWhatsAppRunGuard, WHATSAPP_TIMEOUT_CODE } = require('./whatsAppRunGuard')

function createAsyncStream(items) {
    return {
        [Symbol.iterator]: function* () {
            for (const item of items) {
                yield item
            }
        },
    }
}

describe('WhatsApp assistant attachment handoff', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        runAutomaticThreadCompaction
            .mockReset()
            .mockResolvedValue({ compacted: false, hard: false, reason: 'below_threshold' })
        assistantHelper.loadAssistantThreadState.mockReset().mockResolvedValue(null)
        loadWhatsAppHistoryContext.mockReset().mockResolvedValue('')
        loadAssistantActivityContext.mockReset().mockResolvedValue('')
    })

    test('never executes a tool that arrives after the response deadline', async () => {
        jest.useFakeTimers()
        let nextChunk
        const stream = {
            [Symbol.asyncIterator]: () => ({
                next: () =>
                    new Promise(resolve => {
                        nextChunk = resolve
                    }),
            }),
        }
        const guard = createWhatsAppRunGuard(Date.now() + 1000)
        const processing = guard.run(() =>
            collectStreamWithToolCalls(
                stream,
                [['user', 'Create a task']],
                'MODEL_GPT4O',
                'TEMPERATURE_NORMAL',
                ['create_task'],
                'p1',
                'a1',
                'u1',
                { whatsAppRunGuard: guard }
            )
        )
        const result = expect(processing).rejects.toMatchObject({ code: WHATSAPP_TIMEOUT_CODE })
        try {
            await jest.advanceTimersByTimeAsync(1000)
            await result
            nextChunk({
                done: false,
                value: {
                    additional_kwargs: {
                        tool_calls: [{ id: 'late', function: { name: 'create_task', arguments: '{}' } }],
                    },
                },
            })
            await jest.advanceTimersByTimeAsync(0)
            expect(guard.signal.aborted).toBe(true)
            expect(assistantHelper.executeToolNatively).not.toHaveBeenCalled()
            expect(assistantHelper.interactWithChatStream).not.toHaveBeenCalled()
        } finally {
            jest.useRealTimers()
        }
    })

    function prepareMessage() {
        getUserData.mockResolvedValue({ gold: 10, language: 'de' })
        assistantHelper.getAssistantForChat.mockResolvedValue({ uid: 'a1', model: 'MODEL_GPT4O', allowedTools: [] })
        getConversationHistory.mockResolvedValue([['user', 'latest request']])
        assistantHelper.interactWithChatStream.mockResolvedValue(createAsyncStream([{ content: 'Done.' }]))
    }

    test('uses the rolling summary, previous daily history and shared notices with the current message exactly once', async () => {
        prepareMessage()
        assistantHelper.loadAssistantThreadState.mockResolvedValueOnce({
            summary: 'Earlier decisions',
            trimHistoryBeforeMs: 100,
            trimHistoryBeforeMessageId: 'm10',
        })
        loadWhatsAppHistoryContext.mockResolvedValueOnce('Yesterday: discuss the meeting')
        loadAssistantActivityContext.mockResolvedValueOnce('Displayed activity: agenda updated')
        await processWhatsAppAssistantMessage('u1', 'p1', 'today', 'latest request', 'a1', null, {
            skipCurrentMessageAppend: true,
            messageId: 'm20',
        })
        const messages = assistantHelper.interactWithChatStream.mock.calls[0][0]
        expect(messages).toContainEqual(['system', 'Earlier decisions'])
        expect(messages).toContainEqual(['system', 'Displayed activity: agenda updated'])
        expect(messages).toContainEqual(['system', expect.stringContaining('Yesterday: discuss the meeting')])
        expect(messages.filter(([role]) => role === 'user')).toEqual([['user', 'latest request']])
        expect(getConversationHistory).toHaveBeenCalledWith('p1', 'today', 20, null, 100, {
            trimHistoryBeforeMessageId: 'm10',
            triggeringMessageId: 'm20',
        })
        expect(runAutomaticThreadCompaction).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ hardOnly: true, triggeringMessageId: 'm20', assistantId: 'a1' })
        )
        expect(runAutomaticThreadCompaction).toHaveBeenNthCalledWith(2, expect.objectContaining({ hardOnly: false }))
        expect(runAutomaticThreadCompaction.mock.invocationCallOrder[1]).toBeGreaterThan(
            storeAssistantMessageInTopic.mock.invocationCallOrder[0]
        )
        expect(loadAssistantActivityContext).toHaveBeenCalledWith(expect.anything(), 'u1')
    })

    test('does not silently drop older messages if required compaction fails', async () => {
        prepareMessage()
        runAutomaticThreadCompaction.mockResolvedValueOnce({ hard: true, compacted: false, reason: 'in_progress' })
        await expect(processWhatsAppAssistantMessage('u1', 'p1', 'today', 'request', 'a1')).rejects.toThrow(
            'Hard thread compaction did not complete'
        )
        expect(assistantHelper.interactWithChatStream).not.toHaveBeenCalled()
        expect(storeAssistantMessageInTopic).not.toHaveBeenCalled()
    })

    test('returns the stored response even when post-response summarization fails', async () => {
        prepareMessage()
        runAutomaticThreadCompaction
            .mockResolvedValueOnce({ hard: false })
            .mockRejectedValueOnce(new Error('summary unavailable'))
        await expect(processWhatsAppAssistantMessage('u1', 'p1', 'today', 'request', 'a1')).resolves.toBe('Done.')
        expect(storeAssistantMessageInTopic).toHaveBeenCalledTimes(1)
        expect(assistantHelper.interactWithChatStream).toHaveBeenCalledTimes(1)
    })

    test('passes current message context into WhatsApp tool runtime context', async () => {
        getUserData.mockResolvedValue({ gold: 10, language: 'en' })
        assistantHelper.getAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            model: 'MODEL_GPT4O',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: '',
            displayName: 'Helper',
            allowedTools: ['get_chat_attachment'],
        })
        getConversationHistory.mockResolvedValue([['user', 'prior message']])
        assistantHelper.interactWithChatStream.mockResolvedValue(createAsyncStream([{ content: 'Done.' }]))

        const response = await processWhatsAppAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Please send this invoice',
            'assistant-1',
            null,
            { skipCurrentMessageAppend: true, messageId: 'comment-123', whatsappFromNumber: 'whatsapp:+123' }
        )

        expect(response).toBe('Done.')
        expect(assistantHelper.interactWithChatStream).toHaveBeenCalledWith(
            expect.any(Array),
            'MODEL_GPT4O',
            'TEMPERATURE_NORMAL',
            ['get_chat_attachment'],
            expect.objectContaining({
                projectId: 'project-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
                objectType: 'topics',
                objectId: 'chat-1',
                messageId: 'comment-123',
                sourceChannel: 'whatsapp',
                whatsappFromNumber: 'whatsapp:+123',
                // The sender is the number WhatsApp verified, so they may correct the project wiki.
                allowKnowledgeCorrections: true,
            })
        )
        expect(assistantHelper.addBaseInstructions.mock.calls[0][6]).toMatchObject({
            requestUserId: 'user-1',
            allowKnowledgeCorrections: true,
        })
        expect(storeAssistantMessageInTopic).toHaveBeenCalled()
    })

    test('preserves legitimate response text containing undefined values', async () => {
        const responseText = 'The signup notification contained “undefined [undefined]”.'
        const response = await collectStreamWithToolCalls(
            createAsyncStream([{ content: responseText }]),
            [['user', 'Why does the notification contain undefined values?']],
            'MODEL_GPT4O',
            'TEMPERATURE_NORMAL',
            [],
            'project-1',
            'assistant-1',
            'user-1'
        )

        expect(response).toBe(responseText)
    })

    test('passes multimodal current-message images through to the model context', async () => {
        getUserData.mockResolvedValue({ gold: 10, language: 'en' })
        assistantHelper.getAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            model: 'MODEL_GPT4O',
            temperature: 'TEMPERATURE_NORMAL',
            instructions: '',
            displayName: 'Helper',
            allowedTools: ['create_task'],
        })
        getConversationHistory.mockResolvedValue([])
        assistantHelper.interactWithChatStream.mockResolvedValue(createAsyncStream([{ content: 'Done.' }]))

        const userMessageContent = [
            { type: 'text', text: 'Create a task from this' },
            { type: 'image_url', image_url: { url: 'https://cdn.example.com/uploads/task-image.png' } },
        ]

        await processWhatsAppAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Create a task from this',
            'assistant-1',
            userMessageContent
        )

        const messages = assistantHelper.interactWithChatStream.mock.calls[0][0]
        expect(messages[messages.length - 1]).toEqual(['user', userMessageContent])
    })

    test('injects current-message attachment into the next external tool call', async () => {
        const stream = createAsyncStream([
            {
                additional_kwargs: {
                    tool_calls: [
                        {
                            id: 'tool-1',
                            function: {
                                name: 'get_chat_attachment',
                                arguments: JSON.stringify({}),
                            },
                        },
                    ],
                },
            },
        ])

        assistantHelper.executeToolNatively
            .mockResolvedValueOnce({
                success: true,
                fileName: 'invoice.pdf',
                fileBase64: 'YWJjMTIz',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
                messageId: 'comment-123',
            })
            .mockResolvedValueOnce({
                success: true,
                delivered: true,
            })

        assistantHelper.interactWithChatStream.mockResolvedValueOnce(
            createAsyncStream([
                {
                    additional_kwargs: {
                        tool_calls: [
                            {
                                id: 'tool-2',
                                function: {
                                    name: 'external_tool_bookkeeping_send_invoice',
                                    arguments: JSON.stringify({ destination: 'bookkeeping' }),
                                },
                            },
                        ],
                    },
                },
            ])
        )

        assistantHelper.interactWithChatStream.mockResolvedValueOnce(createAsyncStream([{ content: 'Sent.' }]))

        const response = await collectStreamWithToolCalls(
            stream,
            [['user', 'Please send this invoice']],
            'MODEL_GPT4O',
            'TEMPERATURE_NORMAL',
            ['get_chat_attachment', 'external_tools'],
            'project-1',
            'assistant-1',
            'user-1',
            {
                projectId: 'project-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
                objectType: 'topics',
                objectId: 'chat-1',
                messageId: 'comment-123',
            }
        )

        expect(response).toBe('Sent.')
        expect(assistantHelper.executeToolNatively).toHaveBeenNthCalledWith(
            1,
            'get_chat_attachment',
            {},
            'project-1',
            'assistant-1',
            'user-1',
            expect.any(Object),
            expect.objectContaining({ messageId: 'comment-123' })
        )
        expect(assistantHelper.executeToolNatively).toHaveBeenNthCalledWith(
            2,
            'external_tool_bookkeeping_send_invoice',
            expect.objectContaining({
                destination: 'bookkeeping',
                fileName: 'invoice.pdf',
                fileBase64: 'YWJjMTIz',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
            }),
            'project-1',
            'assistant-1',
            'user-1',
            expect.any(Object),
            expect.objectContaining({ messageId: 'comment-123' })
        )

        const resumedConversations = assistantHelper.interactWithChatStream.mock.calls.map(call => call[0])
        const externalToolReplay = resumedConversations.find(conversation =>
            conversation.some(
                entry =>
                    entry?.role === 'assistant' &&
                    Array.isArray(entry.tool_calls) &&
                    entry.tool_calls.some(
                        toolCall => toolCall?.function?.name === 'external_tool_bookkeeping_send_invoice'
                    )
            )
        )

        expect(externalToolReplay).toBeTruthy()
        expect(externalToolReplay[externalToolReplay.length - 3]).toEqual(
            expect.objectContaining({
                role: 'assistant',
                tool_calls: [
                    expect.objectContaining({
                        function: expect.objectContaining({
                            arguments: expect.stringContaining(
                                '[omitted from conversation; preserved for the next external tool call]'
                            ),
                        }),
                    }),
                ],
            })
        )
    })

    test('does not override external tool file args already provided by the model', async () => {
        const stream = createAsyncStream([
            {
                additional_kwargs: {
                    tool_calls: [
                        {
                            id: 'tool-1',
                            function: {
                                name: 'get_chat_attachment',
                                arguments: JSON.stringify({}),
                            },
                        },
                    ],
                },
            },
        ])

        assistantHelper.executeToolNatively
            .mockResolvedValueOnce({
                success: true,
                fileName: 'invoice.pdf',
                fileBase64: 'YWJjMTIz',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
                messageId: 'comment-123',
            })
            .mockResolvedValueOnce({
                success: true,
            })

        assistantHelper.interactWithChatStream.mockResolvedValueOnce(
            createAsyncStream([
                {
                    additional_kwargs: {
                        tool_calls: [
                            {
                                id: 'tool-2',
                                function: {
                                    name: 'external_tool_bookkeeping_send_invoice',
                                    arguments: JSON.stringify({
                                        fileName: 'custom.pdf',
                                        fileBase64: 'ZGVmNDU2',
                                    }),
                                },
                            },
                        ],
                    },
                },
                { content: 'Sent.' },
            ])
        )

        assistantHelper.interactWithChatStream.mockResolvedValueOnce(createAsyncStream([{ content: 'Sent.' }]))

        await collectStreamWithToolCalls(
            stream,
            [['user', 'Please send this invoice']],
            'MODEL_GPT4O',
            'TEMPERATURE_NORMAL',
            ['get_chat_attachment', 'external_tools'],
            'project-1',
            'assistant-1',
            'user-1',
            {
                projectId: 'project-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
                objectType: 'topics',
                objectId: 'chat-1',
                messageId: 'comment-123',
            }
        )

        expect(assistantHelper.executeToolNatively).toHaveBeenNthCalledWith(
            2,
            'external_tool_bookkeeping_send_invoice',
            expect.objectContaining({
                fileName: 'custom.pdf',
                fileBase64: 'ZGVmNDU2',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
            }),
            'project-1',
            'assistant-1',
            'user-1',
            expect.any(Object),
            expect.any(Object)
        )
    })

    test('injects current-message image URLs into create_task when the model omits images', async () => {
        const stream = createAsyncStream([
            {
                additional_kwargs: {
                    tool_calls: [
                        {
                            id: 'tool-1',
                            function: {
                                name: 'create_task',
                                arguments: JSON.stringify({
                                    name: 'Neue Aufgabe',
                                    description: 'Bild aus dem Chat angehängt.',
                                }),
                            },
                        },
                    ],
                },
            },
        ])

        assistantHelper.executeToolNatively.mockResolvedValueOnce({
            success: true,
            taskId: 'task-1',
            projectId: 'project-1',
        })
        assistantHelper.interactWithChatStream.mockResolvedValueOnce(createAsyncStream([{ content: 'Erledigt.' }]))

        await collectStreamWithToolCalls(
            stream,
            [
                [
                    'user',
                    [
                        { type: 'text', text: 'Bitte erstelle eine Aufgabe' },
                        { type: 'image_url', image_url: { url: 'https://cdn.example.com/uploads/task-image.png' } },
                    ],
                ],
            ],
            'MODEL_GPT4O',
            'TEMPERATURE_NORMAL',
            ['create_task'],
            'project-1',
            'assistant-1',
            'user-1',
            {
                projectId: 'project-1',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
                objectType: 'topics',
                objectId: 'chat-1',
                messageId: 'comment-123',
            }
        )

        expect(assistantHelper.executeToolNatively).toHaveBeenCalledWith(
            'create_task',
            expect.objectContaining({
                name: 'Neue Aufgabe',
                description: 'Bild aus dem Chat angehängt.',
                images: ['https://cdn.example.com/uploads/task-image.png'],
            }),
            'project-1',
            'assistant-1',
            'user-1',
            expect.objectContaining({
                currentMessageImageUrls: ['https://cdn.example.com/uploads/task-image.png'],
            }),
            expect.objectContaining({ messageId: 'comment-123' })
        )
    })
})
