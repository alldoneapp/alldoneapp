jest.mock('../Assistant/assistantHelper', () => ({
    interactWithChatStream: jest.fn(),
    getAssistantForChat: jest.fn(),
    addBaseInstructions: jest.fn(async () => {}),
    reduceGoldWhenChatWithAI: jest.fn(),
    executeToolNatively: jest.fn(),
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

const assistantHelper = require('../Assistant/assistantHelper')
const { getUserData } = require('../Users/usersFirestore')
const { getConversationHistory, storeAssistantMessageInTopic } = require('./whatsAppDailyTopic')
const { processWhatsAppAssistantMessage, collectStreamWithToolCalls } = require('./whatsAppAssistantBridge')

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
            { skipCurrentMessageAppend: true, messageId: 'comment-123' }
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
            })
        )
        expect(storeAssistantMessageInTopic).toHaveBeenCalled()
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

        const resumedConversation = assistantHelper.interactWithChatStream.mock.calls[0][0]
        expect(resumedConversation[resumedConversation.length - 2]).toEqual(
            expect.objectContaining({
                role: 'tool',
                content: expect.stringContaining(
                    '[omitted from conversation; preserved for the next external tool call]'
                ),
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
