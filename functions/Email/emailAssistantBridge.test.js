'use strict'

const mockAddBaseInstructions = jest.fn(async messages => {
    messages.push(['system', 'base instructions'])
})
const mockGetAssistantForChat = jest.fn()
const mockInteractWithChatStream = jest.fn()
const mockReduceGoldWhenChatWithAI = jest.fn().mockResolvedValue(undefined)
const mockExecuteToolNatively = jest.fn()
const mockGetExternalIntegrationToolName = jest.fn()

jest.mock('../Assistant/assistantHelper', () => ({
    addBaseInstructions: mockAddBaseInstructions,
    buildConversationSafeToolArgs: jest.requireActual('../Assistant/attachmentToolHandoff')
        .buildConversationSafeToolArgs,
    buildConversationSafeToolResult: jest.fn((toolName, result) => result),
    buildPendingAttachmentPayload: jest.fn(() => null),
    executeToolNatively: mockExecuteToolNatively,
    getAssistantForChat: mockGetAssistantForChat,
    getExternalIntegrationToolName: mockGetExternalIntegrationToolName,
    getMessageTextForTokenCounting: jest.fn(value => value),
    getToolResultFollowUpPrompt: jest.fn(() => 'Continue'),
    injectPendingAttachmentIntoToolArgs: jest.requireActual('../Assistant/attachmentToolHandoff')
        .injectPendingAttachmentIntoToolArgs,
    interactWithChatStream: mockInteractWithChatStream,
    isToolAllowedForExecution: jest.fn().mockResolvedValue(true),
    normalizeModelKey: jest.fn(model => model || 'MODEL_GPT6_SOL'),
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
        mockGetExternalIntegrationToolName.mockResolvedValue(null)
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

    test('tells Anna that a BCC reply is private to the sender', async () => {
        await processAnnaEmailAssistantMessage('user-1', 'project-1', 'chat-1', 'Please help', 'assistant-1', {
            fromEmail: 'owner@example.com',
            toEmails: ['guest@example.com'],
            ccEmails: [],
            replyToSenderOnly: true,
            hasAdditionalRecipients: false,
        })
        const systemText = mockInteractWithChatStream.mock.calls[0][0]
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')
        expect(systemText).toContain('Your final reply will be sent only to the sender')
        expect(systemText).not.toContain('Continue replying to all participants')
        expect(systemText).not.toContain('Your reply may be sent to the sender and every original')
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

    test('keeps all safe email tool schemas directly visible instead of using deferred tool search', async () => {
        await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Please process the attached invoice',
            'assistant-1',
            {
                fromEmail: 'owner@example.com',
                toEmail: 'owner@example.com',
                toEmails: ['anna@alldoneapp.com'],
                skipCurrentMessageAppend: true,
            }
        )

        expect(mockInteractWithChatStream.mock.calls[0][4]).toEqual(
            expect.objectContaining({
                channel: 'email',
                disableToolSearch: true,
                respectPublicMeetingLinkSettings: true,
            })
        )
    })

    test('uses the optional inbound email model for requests and cost attribution', async () => {
        mockGetAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            displayName: 'Anna',
            allowedTools: [],
            instructions: '',
            model: 'MODEL_GPT6_SOL',
            emailModel: 'MODEL_GPT6_LUNA',
            temperature: 'TEMPERATURE_NORMAL',
        })
        mockInteractWithChatStream.mockReturnValueOnce([{ content: 'Done.' }])

        await processAnnaEmailAssistantMessage('user-1', 'project-1', 'chat-1', 'Create a task', 'assistant-1')

        expect(mockInteractWithChatStream).toHaveBeenCalledWith(
            expect.any(Array),
            'MODEL_GPT6_LUNA',
            'TEMPERATURE_NORMAL',
            expect.any(Array),
            expect.any(Object)
        )
        expect(mockReduceGoldWhenChatWithAI).toHaveBeenCalledWith(
            'user-1',
            100,
            'MODEL_GPT6_LUNA',
            'Done.',
            expect.any(Array),
            expect.any(Object),
            expect.any(Object)
        )
    })

    test('inherits the normal assistant model when no inbound email override is set', () => {
        expect(__private__.resolveInboundEmailModel({ model: 'MODEL_GPT5_6_TERRA' })).toBe('MODEL_GPT5_6_TERRA')
    })

    test('keeps an explicitly emailed task request as a direct user_request', async () => {
        mockGetAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            displayName: 'Anna',
            allowedTools: ['create_task'],
            instructions: '',
            model: 'MODEL_GPT5_5',
            temperature: 'TEMPERATURE_NORMAL',
        })
        getConversationHistory.mockResolvedValue([['user', 'Please create a task to pay invoice 42']])
        mockExecuteToolNatively.mockResolvedValue({
            success: true,
            taskId: 'task-42',
            projectId: 'project-1',
        })
        mockInteractWithChatStream
            .mockReturnValueOnce([
                {
                    additional_kwargs: {
                        tool_calls: [
                            {
                                id: 'tool-1',
                                function: {
                                    name: 'create_task',
                                    arguments: JSON.stringify({
                                        name: 'Pay invoice 42',
                                        taskOrigin: 'user_request',
                                    }),
                                },
                            },
                        ],
                    },
                },
            ])
            .mockReturnValueOnce([{ content: 'Task created.' }])

        await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Please create a task to pay invoice 42',
            'assistant-1'
        )

        const systemText = mockInteractWithChatStream.mock.calls[0][0]
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemText).toContain(
            'use taskOrigin=user_request only when the sender explicitly asks to create that specific task'
        )
        expect(systemText).toContain('use taskOrigin=assistant_suggestion')
        expect(systemText).toContain('concise visible comment with the concrete reason')

        expect(mockExecuteToolNatively).toHaveBeenCalledWith(
            'create_task',
            expect.objectContaining({
                name: 'Pay invoice 42',
                taskOrigin: 'user_request',
                projectId: 'project-1',
            }),
            'project-1',
            'assistant-1',
            'user-1',
            expect.any(Object),
            expect.objectContaining({ channel: 'email' })
        )
    })

    test('does not resend an invoice binary in the follow-up model request', async () => {
        mockGetAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            displayName: 'Anna',
            allowedTools: ['external_tool_bookkeeping_attach_invoice'],
            instructions: '',
            model: 'MODEL_GPT6_SOL',
            temperature: 'TEMPERATURE_NORMAL',
        })
        const fileBase64 = Buffer.alloc(4096, 23).toString('base64')
        mockGetExternalIntegrationToolName.mockResolvedValue('external_tool_bookkeeping_attach_invoice')
        mockExecuteToolNatively.mockResolvedValue({ success: true, status: 'matched' })
        mockInteractWithChatStream
            .mockReturnValueOnce([
                {
                    additional_kwargs: {
                        tool_calls: [
                            {
                                id: 'tool-invoice',
                                function: {
                                    name: 'external_tool_bookkeeping_attach_invoice',
                                    arguments: JSON.stringify({
                                        fileName: 'invoice.pdf',
                                        fileBase64,
                                    }),
                                },
                            },
                        ],
                    },
                },
            ])
            .mockReturnValueOnce([{ content: 'Invoice attached.' }])

        await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Please attach this invoice',
            'assistant-1',
            {
                initialPendingAttachmentPayload: {
                    fileName: 'invoice.pdf',
                    fileBase64,
                    fileMimeType: 'application/pdf',
                    source: 'email',
                    messageId: 'message-1',
                },
                autoAttachInvoice: true,
            }
        )

        const followUpMessages = mockInteractWithChatStream.mock.calls[1][0]
        const completedToolCall = followUpMessages.find(message => message.role === 'assistant').tool_calls[0]
        const safeArgs = JSON.parse(completedToolCall.function.arguments)
        expect(safeArgs.fileBase64).toBe('[omitted from conversation; preserved for the next external tool call]')
        expect(safeArgs.fileBase64Length).toBe(fileBase64.length)
        expect(completedToolCall.function.arguments).not.toContain(fileBase64)
        expect(mockExecuteToolNatively).toHaveBeenCalledTimes(1)
    })

    test('auto-attaches a confirmed invoice when the assistant skips the bookkeeping tool', async () => {
        const invoiceToolName = 'external_tool_bookkeeping_assistant__f5f03fdb4d16'
        const fileBase64 = Buffer.from('invoice-pdf-bytes').toString('base64')
        mockGetAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            displayName: 'Anna',
            allowedTools: ['external_tools'],
            instructions: '',
            model: 'MODEL_GPT6_LUNA',
            temperature: 'TEMPERATURE_NORMAL',
        })
        getConversationHistory.mockResolvedValue([['user', 'Subject: Fwd: GitLab receipt']])
        mockGetExternalIntegrationToolName.mockResolvedValue(invoiceToolName)
        mockExecuteToolNatively.mockResolvedValue({ success: true, status: 'matched' })
        mockInteractWithChatStream
            .mockReturnValueOnce([{ content: 'The PDF is not available to transfer.' }])
            .mockReturnValueOnce([{ content: 'Invoice attached successfully.' }])

        const responseText = await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Subject: Fwd: GitLab receipt',
            'assistant-1',
            {
                initialPendingAttachmentPayload: {
                    fileName: 'INV00615071.pdf',
                    fileBase64,
                    fileMimeType: 'application/pdf',
                    fileSizeBytes: 17,
                    source: 'email',
                    messageId: 'message-1',
                },
                autoAttachInvoice: true,
                skipCurrentMessageAppend: true,
            }
        )

        expect(responseText).toBe('Invoice attached successfully.')
        expect(mockExecuteToolNatively).toHaveBeenCalledTimes(1)
        expect(mockExecuteToolNatively).toHaveBeenCalledWith(
            invoiceToolName,
            expect.objectContaining({
                fileName: 'INV00615071.pdf',
                fileBase64,
                mimeType: 'application/pdf',
            }),
            'project-1',
            'assistant-1',
            'user-1',
            expect.any(Object),
            expect.objectContaining({ channel: 'email' })
        )

        const followUpMessages = mockInteractWithChatStream.mock.calls[1][0]
        const forcedToolCall = followUpMessages.find(message => message.role === 'assistant').tool_calls[0]
        const safeArgs = JSON.parse(forcedToolCall.function.arguments)
        expect(safeArgs.fileBase64).toBe('[omitted from conversation; preserved for the next external tool call]')
        expect(forcedToolCall.function.arguments).not.toContain(fileBase64)
    })

    test.each(['create_gmail_reply_draft', 'external_tool_other_upload'])(
        'still uploads the original invoice after %s consumes the attachment',
        async otherToolName => {
            const invoiceToolName = 'external_tool_bookkeeping_assistant__f5f03fdb4d16'
            const fileBase64 = Buffer.from('original-invoice-bytes').toString('base64')
            mockGetAssistantForChat.mockResolvedValue({
                uid: 'assistant-1',
                displayName: 'Anna',
                allowedTools: ['external_tools', 'create_task', 'create_gmail_reply_draft'],
                instructions: '',
                model: 'MODEL_GPT6_LUNA',
            })
            mockGetExternalIntegrationToolName.mockResolvedValue(invoiceToolName)
            mockExecuteToolNatively
                .mockResolvedValueOnce({ success: true, taskId: 'task-1', projectId: 'project-1' })
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ success: true, status: 'matched' })
            const toolChunk = (name, args = {}) => [
                {
                    additional_kwargs: {
                        tool_calls: [{ id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } }],
                    },
                },
            ]
            mockInteractWithChatStream
                .mockReturnValueOnce(
                    toolChunk('create_task', { name: 'Match invoice', taskOrigin: 'assistant_suggestion' })
                )
                .mockReturnValueOnce(toolChunk(otherToolName))
                .mockReturnValueOnce([{ content: 'Draft or other upload completed.' }])
                .mockReturnValueOnce([{ content: 'Invoice attached to bookkeeping.' }])

            const response = await processAnnaEmailAssistantMessage(
                'user-1',
                'project-1',
                'chat-1',
                'Forwarded invoice',
                'assistant-1',
                {
                    initialPendingAttachmentPayload: {
                        fileName: 'invoice.pdf',
                        fileBase64,
                        fileMimeType: 'application/pdf',
                    },
                    autoAttachInvoice: true,
                }
            )

            expect(response).toBe('Invoice attached to bookkeeping.')
            expect(mockExecuteToolNatively.mock.calls.map(call => call[0])).toEqual([
                'create_task',
                otherToolName,
                invoiceToolName,
            ])
            expect(mockExecuteToolNatively.mock.calls[2][1]).toEqual(
                expect.objectContaining({ fileName: 'invoice.pdf', fileBase64 })
            )
            for (const [messages] of mockInteractWithChatStream.mock.calls) {
                expect(JSON.stringify(messages)).not.toContain(fileBase64)
            }
            const systemText = mockInteractWithChatStream.mock.calls[0][0]
                .filter(message => message[0] === 'system')
                .map(message => message[1])
                .join('\n')
            expect(systemText).toContain(invoiceToolName)
            expect(systemText).toContain('original bytes even if another tool also uses the file')
            expect(systemText).toContain('Create a Gmail draft only when the sender explicitly asks')
            expect(systemText).toContain('omitted base64 does not mean the file is unavailable')
        }
    )

    test('supplies the original invoice when the model calls bookkeeping after creating a draft', async () => {
        const invoiceToolName = 'external_tool_bookkeeping_assistant__f5f03fdb4d16'
        const fileBase64 = Buffer.from('late-bookkeeping-upload').toString('base64')
        mockGetExternalIntegrationToolName.mockResolvedValue(invoiceToolName)
        mockExecuteToolNatively.mockResolvedValue({ success: true })
        const toolChunk = name => [
            { additional_kwargs: { tool_calls: [{ id: name, function: { name, arguments: '{}' } }] } },
        ]
        mockInteractWithChatStream
            .mockReturnValueOnce(toolChunk('create_gmail_reply_draft'))
            .mockReturnValueOnce(toolChunk(invoiceToolName))
            .mockReturnValueOnce([{ content: 'Invoice uploaded.' }])
        await processAnnaEmailAssistantMessage('user-1', 'project-1', 'chat-1', 'Forwarded invoice', 'assistant-1', {
            initialPendingAttachmentPayload: { fileName: 'invoice.pdf', fileBase64, fileMimeType: 'application/pdf' },
            autoAttachInvoice: true,
        })
        expect(mockExecuteToolNatively).toHaveBeenCalledTimes(2)
        expect(mockExecuteToolNatively.mock.calls[1][1]).toEqual(expect.objectContaining({ fileBase64 }))
        expect(mockInteractWithChatStream.mock.calls[2][0].at(-1).content).toContain(
            'do not upload the same invoice again'
        )
    })

    test('an unrelated tool error does not suppress invoice delivery', async () => {
        const invoiceToolName = 'external_tool_bookkeeping_assistant__f5f03fdb4d16'
        mockGetExternalIntegrationToolName.mockResolvedValue(invoiceToolName)
        mockExecuteToolNatively
            .mockRejectedValueOnce(new Error('Draft failed'))
            .mockResolvedValueOnce({ success: true })
        mockInteractWithChatStream
            .mockReturnValueOnce([
                {
                    additional_kwargs: {
                        tool_calls: [{ id: 'draft', function: { name: 'create_gmail_reply_draft', arguments: '{}' } }],
                    },
                },
            ])
            .mockReturnValueOnce([{ content: 'Invoice uploaded; draft failed.' }])
        const response = await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Forwarded invoice',
            'assistant-1',
            {
                initialPendingAttachmentPayload: {
                    fileName: 'invoice.pdf',
                    fileBase64: 'YWJj',
                    fileMimeType: 'application/pdf',
                },
                autoAttachInvoice: true,
            }
        )
        expect(response).toBe('Invoice uploaded; draft failed.')
        expect(mockExecuteToolNatively.mock.calls.map(call => call[0])).toEqual([
            'create_gmail_reply_draft',
            invoiceToolName,
        ])
        expect(mockInteractWithChatStream.mock.calls[1][0]).toContainEqual({
            role: 'assistant',
            content: 'Tool failed',
        })
    })

    test('does not automatically upload an invoice when the sender opted out', async () => {
        mockGetExternalIntegrationToolName.mockResolvedValue('external_tool_bookkeeping_assistant__f5f03fdb4d16')
        await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Do not forward to bookkeeping',
            'assistant-1',
            {
                initialPendingAttachmentPayload: { fileName: 'invoice.pdf', fileBase64: 'YWJj' },
                autoAttachInvoice: false,
            }
        )
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
        expect(mockGetExternalIntegrationToolName).not.toHaveBeenCalled()
    })

    test('does not repeat a failed bookkeeping attempt as an automatic fallback', async () => {
        const invoiceToolName = 'external_tool_bookkeeping_assistant__f5f03fdb4d16'
        mockGetExternalIntegrationToolName.mockResolvedValue(invoiceToolName)
        mockExecuteToolNatively.mockResolvedValue({ success: false, message: 'Upload rejected' })
        mockInteractWithChatStream
            .mockReturnValueOnce([
                {
                    additional_kwargs: {
                        tool_calls: [{ id: 'invoice', function: { name: invoiceToolName, arguments: '{}' } }],
                    },
                },
            ])
            .mockReturnValueOnce([{ content: 'Upload rejected.' }])
        const response = await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Forwarded invoice',
            'assistant-1',
            {
                initialPendingAttachmentPayload: { fileName: 'invoice.pdf', fileBase64: 'YWJj' },
                autoAttachInvoice: true,
            }
        )
        expect(response).toBe('Upload rejected.')
        expect(mockExecuteToolNatively).toHaveBeenCalledTimes(1)
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
        expect(initialSystemText).toContain('A request for today or a same-day meeting may override')
        expect(finalInstruction).toContain(
            "represents Karsten's availability across Karsten's connected calendars, not Anna's availability or calendar"
        )
        expect(finalInstruction).toContain('Attribute every free or available time to Karsten')
        expect(mockInteractWithChatStream.mock.calls[0][4]).toEqual(
            expect.objectContaining({
                calendarOwnerName: 'Karsten',
                respectPublicMeetingLinkSettings: true,
            })
        )
        expect(mockExecuteToolNatively).toHaveBeenCalledWith(
            'find_calendar_availability',
            expect.any(Object),
            'project-1',
            'assistant-1',
            'user-1',
            expect.any(Object),
            expect.objectContaining({ respectPublicMeetingLinkSettings: true })
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

    test('returns only stripped availability metadata for a scoped guest grant', async () => {
        mockGetAssistantForChat.mockResolvedValue({
            uid: 'assistant-1',
            displayName: 'Anna',
            allowedTools: ['find_calendar_availability', 'create_calendar_event'],
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
                    start: '2026-08-21T09:00:00+02:00',
                    end: '2026-08-21T09:30:00+02:00',
                    eventTitle: 'Private event',
                },
            ],
            calendarEmail: 'private@example.com',
        })
        mockInteractWithChatStream
            .mockReturnValueOnce([
                {
                    additional_kwargs: {
                        tool_calls: [
                            {
                                id: 'tool-availability',
                                function: {
                                    name: 'find_calendar_availability',
                                    arguments: JSON.stringify({
                                        timeMin: '2026-08-21T09:00:00+02:00',
                                        timeMax: '2026-08-21T17:00:00+02:00',
                                    }),
                                },
                            },
                        ],
                    },
                },
            ])
            .mockReturnValueOnce([{ content: 'Karsten is available Friday at 09:00.' }])

        const result = await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Please propose a meeting slot Friday',
            'assistant-1',
            {
                fromEmail: 'owner@example.com',
                toEmail: 'owner@example.com',
                toEmails: ['anna@alldoneapp.com'],
                ccEmails: ['guest@example.com'],
                hasAdditionalRecipients: true,
                isParticipantScopedTopic: true,
                skipCurrentMessageAppend: true,
                returnExecutionMetadata: true,
            }
        )

        expect(result).toEqual({
            responseText: 'Karsten is available Friday at 09:00.',
            guestMeetingContext: {
                type: 'calendar_availability',
                timeZone: 'Europe/Berlin',
                durationMinutes: 30,
                options: [
                    {
                        start: '2026-08-21T09:00:00+02:00',
                        end: '2026-08-21T09:30:00+02:00',
                    },
                ],
                createdAt: expect.any(Number),
            },
            canCreateCalendarEvent: true,
            calendarOwnerName: 'Karsten',
            language: 'German',
        })
        expect(result.guestMeetingContext.calendarEmail).toBeUndefined()
    })

    test('does not expose prior availability as a guest grant without a successful current lookup', async () => {
        const result = await processAnnaEmailAssistantMessage(
            'user-1',
            'project-1',
            'chat-1',
            'Please offer the guest some meeting times',
            'assistant-1',
            {
                fromEmail: 'owner@example.com',
                toEmail: 'owner@example.com',
                toEmails: ['anna@alldoneapp.com'],
                ccEmails: ['guest@example.com'],
                hasAdditionalRecipients: true,
                isParticipantScopedTopic: true,
                skipCurrentMessageAppend: true,
                returnExecutionMetadata: true,
            }
        )

        expect(result).toEqual(
            expect.objectContaining({
                responseText: 'Termin erstellt.',
                guestMeetingContext: null,
                canCreateCalendarEvent: true,
            })
        )
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
    })

    test('rewrites first-person German calendar availability as the account owners availability', () => {
        expect(
            __private__.enforceCalendarOwnershipResponse(
                'Ich bin verfügbar. Meine Verfügbarkeit steht in meinem Kalender.',
                'Karsten'
            )
        ).toBe('Karsten ist verfügbar. Karstens Verfügbarkeit steht in Karstens Kalender.')
    })

    test('does not recommend reconnecting for calendar selection failures', () => {
        const prompt = __private__.buildEmailToolResultFollowUpPrompt(
            'create_calendar_event',
            {},
            {
                success: false,
                code: 'calendar_account_ambiguous',
                availableCalendarTargets: [
                    { calendarId: 'one@example.com', calendarEmail: 'one@example.com', isDefault: false },
                ],
            }
        )

        expect(prompt).toContain('Do not tell the sender to connect or reconnect Calendar')
        expect(prompt).toContain('labelled calendar email targets')
        expect(prompt).toContain('Do not retry by treating internal account or project identifiers as calendar IDs')
    })

    test('allows connection guidance only for explicit calendar connection failures', () => {
        const prompt = __private__.buildEmailToolResultFollowUpPrompt(
            'create_calendar_event',
            {},
            { success: false, code: 'calendar_not_connected' }
        )

        expect(prompt).toContain('Connection guidance is appropriate')
        expect(prompt).not.toContain('Do not tell the sender to connect or reconnect Calendar')
    })

    test('allows reconnect guidance for an explicit OAuth failure message without a structured code', () => {
        const prompt = __private__.buildEmailToolResultFollowUpPrompt(
            'create_calendar_event',
            {},
            {
                success: false,
                message: 'Calendar event creation failed: invalid_grant; token has been expired or revoked.',
            }
        )

        expect(prompt).toContain('Connection guidance is appropriate')
        expect(prompt).not.toContain('Do not tell the sender to connect or reconnect Calendar')
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
