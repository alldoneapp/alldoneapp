const {
    normalizeCreateTaskImageUrls,
    buildCreateTaskImageTokens,
    mergeTaskDescriptionWithImages,
    extractImageUrlsFromMessageContent,
    injectCurrentMessageImagesIntoCreateTaskArgs,
} = require('./createTaskImageHelper')
const {
    buildConversationSafeToolArgs,
    buildConversationSafeToolResult,
    buildPendingAttachmentPayload,
    injectPendingAttachmentIntoToolArgs,
} = require('./attachmentToolHandoff')
const { resolveCreateTaskTargetProject } = require('./createTaskProjectResolver')
const { extractMediaContextFromText } = require('../Utils/parseTextUtils')

const mockCreateAndPersistTask = jest.fn()
const mockCreateAndPersistNote = jest.fn()
const mockFetchMentionedNotesContext = jest.fn(async () => '')
const mockFetchNoteContentAsMarkdown = jest.fn(async (projectId, noteId) => ({
    noteId,
    title: 'Launch notes',
    content: '## Note: Launch notes\n\nShip checklist and unresolved rollout risks.',
    markdown: '## Note: Launch notes\n\nShip checklist and unresolved rollout risks.',
    url: `https://app.alldone.app/projects/${projectId}/notes/${noteId}/editor`,
}))

jest.mock('../shared/ProjectService', () => ({
    ProjectService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getUserProjects: jest.fn().mockResolvedValue([]),
    })),
}))
jest.mock('../shared/TaskService', () => ({
    TaskService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        createAndPersistTask: mockCreateAndPersistTask,
    })),
}))
jest.mock('../shared/NoteService', () => ({
    NoteService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        createAndPersistNote: mockCreateAndPersistNote,
    })),
}))
jest.mock('../shared/UserHelper', () => ({
    UserHelper: {
        getFeedUserData: jest.fn().mockResolvedValue({ uid: 'user-1', displayName: 'User One' }),
    },
}))
jest.mock('../shared/TaskRetrievalService', () => {
    const normalizeTimezoneOffset = jest.fn(value => {
        if (typeof value === 'number' && !Number.isNaN(value)) {
            return Math.abs(value) <= 14 ? value * 60 : value
        }
        if (typeof value !== 'string') return null

        const trimmed = value.trim()
        const utcMatch = trimmed.match(/^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/i)
        if (utcMatch) {
            const sign = utcMatch[1] === '-' ? -1 : 1
            const hours = Number(utcMatch[2]) || 0
            const minutes = Number(utcMatch[3]) || 0
            return sign * (hours * 60 + minutes)
        }

        const numeric = Number(trimmed)
        if (!Number.isNaN(numeric)) {
            return Math.abs(numeric) <= 14 ? numeric * 60 : numeric
        }

        return null
    })

    const TaskRetrievalService = jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getTasks: jest.fn().mockResolvedValue({ tasks: [] }),
        getTasksFromMultipleProjects: jest.fn().mockResolvedValue({ tasks: [] }),
    }))

    TaskRetrievalService.normalizeTimezoneOffset = normalizeTimezoneOffset

    return {
        TaskRetrievalService,
    }
})
jest.mock('../shared/ChatRetrievalService', () => ({
    ChatRetrievalService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getChats: jest.fn().mockResolvedValue({
            chats: [],
            count: 0,
            appliedFilters: {
                types: ['topics'],
                date: null,
                limit: 10,
                projectId: null,
                projectName: null,
            },
        }),
    })),
}))
jest.mock('../shared/UpdateRetrievalService', () => ({
    UpdateRetrievalService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getUpdates: jest.fn().mockResolvedValue({
            updates: [],
            count: 0,
            appliedFilters: {
                allProjects: true,
                projectId: null,
                projectName: null,
                date: null,
                recentHours: null,
                objectTypes: null,
                limit: 100,
            },
            queriedProjects: [],
        }),
    })),
}))
jest.mock('../shared/ContactRetrievalService', () => ({
    ContactRetrievalService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getContacts: jest.fn().mockResolvedValue({
            contacts: [],
            count: 0,
            appliedFilters: {
                allProjects: true,
                projectId: null,
                projectName: null,
                date: null,
                limit: 100,
            },
        }),
    })),
}))
jest.mock('../shared/GoalRetrievalService', () => ({
    GoalRetrievalService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getGoals: jest.fn().mockResolvedValue({
            goals: [],
            count: 0,
            appliedFilters: {
                status: 'active',
                allProjects: true,
                projectId: null,
                projectName: null,
                currentMilestoneOnly: false,
                limit: 100,
            },
        }),
    })),
}))
jest.mock('../shared/projectDescriptionUpdateHelper', () => ({
    updateProjectDescription: jest.fn(),
}))
jest.mock('../shared/userDescriptionUpdateHelper', () => ({
    updateUserDescription: jest.fn(),
}))
jest.mock('../shared/projectRoutingCommentHelper', () => ({
    addProjectRoutingReasonComment: jest.fn().mockResolvedValue({
        commentId: 'routing-comment-1',
    }),
}))
jest.mock('./userMemoryHelper', () => {
    const actual = jest.requireActual('./userMemoryHelper')
    return {
        ...actual,
        updateUserMemory: jest.fn(),
    }
})
jest.mock('./noteContextHelper', () => ({
    fetchMentionedNotesContext: mockFetchMentionedNotesContext,
    fetchNoteContentAsMarkdown: mockFetchNoteContentAsMarkdown,
}))
jest.mock('../GAnalytics/GAnalytics', () => ({
    logEvent: jest.fn(),
}))

const mockDocGet = jest.fn()
const mockDocSet = jest.fn(async () => {})
const mockDocUpdate = jest.fn(async () => {})
const mockDocDelete = jest.fn(async () => {})
const mockTransactionGet = jest.fn(ref => ref.get())
const mockTransactionUpdate = jest.fn(async () => {})
const mockCollectionGet = jest.fn()
const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchDelete = jest.fn()
const mockBatchCommit = jest.fn(async () => {})
const mockResponsesCreate = jest.fn()

jest.mock('firebase-admin', () => ({
    app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })),
    firestore: Object.assign(
        jest.fn(() => ({
            doc: jest.fn(path => ({
                path,
                get: mockDocGet,
                set: mockDocSet,
                update: mockDocUpdate,
                delete: mockDocDelete,
            })),
            runTransaction: jest.fn(async callback =>
                callback({
                    get: mockTransactionGet,
                    update: mockTransactionUpdate,
                })
            ),
            collection: jest.fn(() => ({
                doc: jest.fn(path => ({
                    path,
                    get: mockDocGet,
                })),
                get: mockCollectionGet,
                where: jest.fn(() => ({
                    get: mockCollectionGet,
                })),
                orderBy: jest.fn(() => ({
                    limit: jest.fn(() => ({
                        get: mockCollectionGet,
                    })),
                })),
            })),
            batch: jest.fn(() => ({
                set: mockBatchSet,
                update: mockBatchUpdate,
                delete: mockBatchDelete,
                commit: mockBatchCommit,
            })),
        })),
        {
            Timestamp: { now: jest.fn(() => ({ seconds: 0, nanoseconds: 0 })) },
            FieldValue: {
                increment: jest.fn(value => ({ __op: 'increment', value })),
                arrayUnion: jest.fn((...values) => ({ __op: 'arrayUnion', values })),
                delete: jest.fn(() => ({ __op: 'delete' })),
            },
        }
    ),
}))

jest.mock('../WhatsApp/whatsAppFileExtraction', () => ({
    extractTextFromWhatsAppFile: jest.fn(async ({ fileName }) => ({
        extractedText: `Extracted text for ${fileName}`,
        status: 'extracted',
    })),
}))

jest.mock(
    'openai',
    () =>
        jest.fn().mockImplementation(() => ({
            responses: {
                create: mockResponsesCreate,
            },
        })),
    { virtual: true }
)
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
jest.mock(
    'firebase-functions/params',
    () => ({
        defineString: jest.fn(() => ({ value: jest.fn(() => '') })),
    }),
    { virtual: true }
)

const { ProjectService } = require('../shared/ProjectService')
const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
const { ChatRetrievalService } = require('../shared/ChatRetrievalService')
const { UpdateRetrievalService } = require('../shared/UpdateRetrievalService')
const { ContactRetrievalService } = require('../shared/ContactRetrievalService')
const { GoalRetrievalService } = require('../shared/GoalRetrievalService')
const { updateProjectDescription } = require('../shared/projectDescriptionUpdateHelper')
const { updateUserDescription } = require('../shared/userDescriptionUpdateHelper')
const { addProjectRoutingReasonComment } = require('../shared/projectRoutingCommentHelper')
const { updateUserMemory } = require('./userMemoryHelper')
global.fetch = jest.fn()
global.AbortSignal = { timeout: jest.fn(() => undefined) }
const { resolveUserTimezoneOffset } = require('./contextTimestampHelper')
const {
    getChatAttachmentForAssistantRequest,
    listRecentChatMediaForAssistantRequest,
    normalizeCommentMediaContext,
    buildUserMessageContentFromComment,
    addTimestampToContextContent,
    formatContextMessageTimestamp,
    normalizeRecentHours,
    normalizeAssistantTaskScope,
    filterTasksByRecentHours,
    resolveAssistantTaskProject,
    mapAssistantTaskForToolResponse,
    mapAssistantGoalForToolResponse,
    getToolResultFollowUpPrompt,
    addBaseInstructions,
    executeToolNatively,
    isToolAllowedForExecution,
    getHeartbeatSettingsContextMessage,
    getAssistantThreadStateContextMessage,
    getOptimizedContextMessages,
    buildCurrentObjectContextMessage,
    buildVmThreadContext,
    buildConversationAfterToolExecution,
    buildConversationAfterToolExecutions,
    getSilentModeFinalResponseText,
    storeBotAnswerStream,
    calculateGoldCostFromTokens,
    normalizeModelKey,
    getMaxTokensForModel,
    convertMessageContentToResponsesInput,
    convertMessagesToResponsesInput,
    convertToolsToResponsesFormat,
    buildResponsesTools,
    buildOpenAiPromptCacheKey,
    getOpenAiCacheUsage,
    convertResponsesStream,
    interactWithChatStream,
} = require('./assistantHelper')

describe('Current task context', () => {
    test('includes task identity, project, title, description, and relevant metadata', () => {
        const context = buildCurrentObjectContextMessage({
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            projectData: { name: 'Alldone Product' },
            chatData: { title: 'Legacy task chat title' },
            objectData: {
                id: 'task-1',
                name: 'Fix task processor',
                extendedName: '#Must Fix task processor',
                description: 'Show the assistant avatar and preserve the full task context.',
                humanReadableId: 'ALL-97',
                priority: 'must_do',
                recurrence: 'never',
                taskMetadata: { source: 'predefined', execution: 'vm' },
            },
        })

        expect(context).toContain('When the user says "this task", they mean this exact task.')
        expect(context).toContain('Project: Alldone Product (ID: project-1)')
        expect(context).toContain('Task ID: task-1')
        expect(context).toContain('Task title: #Must Fix task processor')
        expect(context).toContain('Task name: Fix task processor')
        expect(context).toContain('Task description: Show the assistant avatar and preserve the full task context.')
        expect(context).toContain('"humanReadableId":"ALL-97"')
        expect(context).toContain('"priority":"must_do"')
        expect(context).toContain('"taskMetadata":{"source":"predefined","execution":"vm"}')
    })
})

describe('Responses API compatibility helpers', () => {
    beforeEach(() => {
        mockResponsesCreate.mockReset()
    })

    test('sends assistant generation through the stateless Responses endpoint', async () => {
        mockResponsesCreate.mockResolvedValue([
            { type: 'response.output_text.delta', delta: 'Hello' },
            { type: 'response.completed', response: { output: [] } },
        ])

        const stream = await interactWithChatStream([['user', 'Hello']], 'MODEL_GPT5_6_SOL', 'TEMPERATURE_NORMAL', [])
        const firstChunk = await stream.next()

        expect(firstChunk.value).toEqual({ content: 'Hello', additional_kwargs: {} })
        expect(mockResponsesCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-5.6-sol',
                input: [{ role: 'user', content: 'Hello' }],
                stream: true,
                store: false,
            })
        )
        expect(mockResponsesCreate.mock.calls[0][0]).not.toHaveProperty('messages')
    })

    test('maps chat messages, multimodal content, tool calls, and tool outputs to Responses items', () => {
        expect(
            convertMessagesToResponsesInput([
                { role: 'system', content: 'Be helpful.' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'What is in this image?' },
                        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
                    ],
                },
                {
                    role: 'assistant',
                    content: 'I will check.',
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'get_note', arguments: '{"noteId":"note-1"}' },
                        },
                    ],
                },
                { role: 'tool', tool_call_id: 'call-1', content: '{"title":"Launch"}' },
            ])
        ).toEqual([
            { role: 'system', content: 'Be helpful.' },
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: 'What is in this image?' },
                    { type: 'input_image', image_url: 'https://example.com/image.png', detail: 'auto' },
                ],
            },
            { role: 'assistant', content: 'I will check.' },
            {
                type: 'function_call',
                call_id: 'call-1',
                name: 'get_note',
                arguments: '{"noteId":"note-1"}',
            },
            { type: 'function_call_output', call_id: 'call-1', output: '{"title":"Launch"}' },
        ])
    })

    test('adds internal prompt cache markers only when explicit caching is enabled', () => {
        const messages = [
            { role: 'system', content: 'Stable instructions', promptCacheBreakpoint: true },
            { role: 'user', content: 'Volatile request' },
        ]

        expect(convertMessagesToResponsesInput(messages)).toEqual([
            { role: 'system', content: 'Stable instructions' },
            { role: 'user', content: 'Volatile request' },
        ])
        expect(convertMessagesToResponsesInput(messages, { includePromptCacheBreakpoints: true })).toEqual([
            {
                role: 'system',
                content: [
                    {
                        type: 'input_text',
                        text: 'Stable instructions',
                        prompt_cache_breakpoint: { mode: 'explicit' },
                    },
                ],
            },
            { role: 'user', content: 'Volatile request' },
        ])
    })

    test('builds stable scoped cache keys and reads both Responses and Chat usage details', () => {
        expect(buildOpenAiPromptCacheKey('gmail-first', 'model', 'project', 'prompt')).toBe(
            buildOpenAiPromptCacheKey('gmail-first', 'model', 'project', 'prompt')
        )
        expect(buildOpenAiPromptCacheKey('gmail-first', 'model', 'project', 'prompt')).not.toBe(
            buildOpenAiPromptCacheKey('gmail-first', 'model', 'project', 'changed prompt')
        )
        expect(getOpenAiCacheUsage({ input_tokens: 1000, input_tokens_details: { cached_tokens: 750 } })).toEqual({
            inputTokens: 1000,
            cachedTokens: 750,
            cacheWriteTokens: 0,
            uncachedInputTokens: 250,
            cacheReadRate: 0.75,
        })
        expect(
            getOpenAiCacheUsage({
                prompt_tokens: 500,
                prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
            })
        ).toEqual(expect.objectContaining({ inputTokens: 500, cachedTokens: 200, cacheWriteTokens: 100 }))
    })

    test('sends an explicit GPT-5.6 cache breakpoint without changing the source message content', async () => {
        mockResponsesCreate.mockResolvedValue([{ type: 'response.completed', response: { output: [] } }])
        const prompt = [
            ['system', 'Stable instructions', { promptCacheBreakpoint: true }],
            ['user', 'Volatile request'],
        ]

        const stream = await interactWithChatStream(prompt, 'MODEL_GPT5_6_SOL', 'TEMPERATURE_NORMAL', [])
        await stream.next()

        expect(prompt[0][1]).toBe('Stable instructions')
        expect(mockResponsesCreate.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                prompt_cache_options: { mode: 'explicit', ttl: '30m' },
                input: expect.arrayContaining([
                    expect.objectContaining({
                        role: 'system',
                        content: expect.arrayContaining([
                            expect.objectContaining({
                                text: 'Stable instructions',
                                prompt_cache_breakpoint: { mode: 'explicit' },
                            }),
                        ]),
                    }),
                ]),
            })
        )
    })

    test('maps Chat Completions function schemas to Responses function schemas without enabling strict mode', () => {
        expect(
            convertToolsToResponsesFormat([
                {
                    type: 'function',
                    function: {
                        name: 'create_task',
                        description: 'Create a task',
                        parameters: { type: 'object', properties: { title: { type: 'string' } } },
                    },
                },
            ])
        ).toEqual([
            {
                type: 'function',
                name: 'create_task',
                description: 'Create a task',
                parameters: { type: 'object', properties: { title: { type: 'string' } } },
                strict: false,
            },
        ])
    })

    test('defers large supported tool sets into small searchable namespaces', () => {
        const tools = Array.from({ length: 12 }, (_, index) => ({
            type: 'function',
            function: {
                name: index < 6 ? `get_task_${index}` : `search_gmail_${index}`,
                description: `Tool ${index}`,
                parameters: { type: 'object', properties: {} },
            },
        }))

        const result = buildResponsesTools(tools, 'MODEL_GPT5_6_SOL')
        const namespaces = result.tools.filter(tool => tool.type === 'namespace')

        expect(result.toolSearchEnabled).toBe(true)
        expect(result.tools[0]).toEqual({ type: 'tool_search' })
        expect(namespaces).toHaveLength(2)
        expect(namespaces.every(namespace => namespace.tools.length <= 8)).toBe(true)
        expect(namespaces.flatMap(namespace => namespace.tools)).toHaveLength(12)
        expect(namespaces.flatMap(namespace => namespace.tools).every(tool => tool.defer_loading === true)).toBe(true)
        expect(result.fallbackTools.every(tool => tool.type === 'function')).toBe(true)
    })

    test('keeps full function schemas for unsupported models and small tool sets', () => {
        const buildTools = count =>
            Array.from({ length: count }, (_, index) => ({
                type: 'function',
                function: { name: `tool_${index}`, description: '', parameters: { type: 'object' } },
            }))

        expect(buildResponsesTools(buildTools(12), 'MODEL_GPT5_2').toolSearchEnabled).toBe(false)
        expect(buildResponsesTools(buildTools(3), 'MODEL_GPT5_6_SOL').toolSearchEnabled).toBe(false)
    })

    test('converts typed Responses stream events to the existing text and tool-call stream contract', async () => {
        const responseEvents = [
            { type: 'response.output_text.delta', delta: 'Hello' },
            {
                type: 'response.output_item.done',
                item: { id: 'search-1', type: 'tool_search_call', status: 'completed' },
            },
            {
                type: 'response.function_call_arguments.done',
                item_id: 'item-1',
                name: 'get_tasks',
                arguments: '{"limit":5}',
            },
            {
                type: 'response.output_item.done',
                item: {
                    id: 'item-1',
                    type: 'function_call',
                    call_id: 'call-1',
                    name: 'get_tasks',
                    arguments: '{"limit":5}',
                },
            },
            {
                type: 'response.completed',
                response: {
                    output: [
                        {
                            id: 'item-1',
                            type: 'function_call',
                            call_id: 'call-1',
                            name: 'get_tasks',
                            arguments: '{"limit":5}',
                        },
                    ],
                },
            },
        ]

        const chunks = []
        const iterator = convertResponsesStream(responseEvents)
        let next = await iterator.next()
        while (!next.done) {
            chunks.push(next.value)
            next = await iterator.next()
        }

        expect(chunks).toEqual([
            { content: 'Hello', additional_kwargs: {} },
            {
                content: '',
                additional_kwargs: {
                    tool_calls: [
                        {
                            id: 'call-1',
                            type: 'function',
                            function: { name: 'get_tasks', arguments: '{"limit":5}' },
                        },
                    ],
                },
            },
        ])
    })

    test('surfaces Responses stream failures', async () => {
        const iterator = convertResponsesStream([{ type: 'error', message: 'Request rejected' }])
        await expect(iterator.next()).rejects.toThrow('Request rejected')
    })

    test('maps standalone multimodal content', () => {
        expect(convertMessageContentToResponsesInput([{ type: 'text', text: 'Hello' }])).toEqual([
            { type: 'input_text', text: 'Hello' },
        ])
    })
})

describe('assistant attachment handoff helpers', () => {
    beforeEach(() => {
        mockDocGet.mockReset()
        mockDocSet.mockClear()
        mockDocUpdate.mockClear()
        mockDocDelete.mockClear()
        mockTransactionGet.mockClear()
        mockTransactionUpdate.mockClear()
        mockCollectionGet.mockReset()
        mockBatchSet.mockClear()
        mockBatchUpdate.mockClear()
        mockBatchDelete.mockClear()
        mockBatchCommit.mockClear()
        mockCreateAndPersistNote.mockReset()
    })

    test('normalizes hour-based user timezone values into minutes', () => {
        expect(resolveUserTimezoneOffset({ timezone: 1 })).toBe(60)
        expect(resolveUserTimezoneOffset({ timezoneOffset: 'UTC+02:30' })).toBe(150)
    })

    test('formats context message timestamps in the user timezone', () => {
        expect(formatContextMessageTimestamp(Date.UTC(2026, 2, 31, 8, 15, 0), 120)).toBe('2026-03-31 10:15:00 UTC+2')
    })

    test('prefers commentText when answerContent is empty for silent mode final checks', () => {
        expect(getSilentModeFinalResponseText('', '\n\nHEARTBEAT_OK')).toBe('\n\nHEARTBEAT_OK')
        expect(getSilentModeFinalResponseText('Final answer', '\n\nHEARTBEAT_OK')).toBe('Final answer')
    })

    test('scales GPT-5.4 nano gold cost down to roughly 8% of GPT-5.5', () => {
        expect(calculateGoldCostFromTokens(100, 'MODEL_GPT5_5')).toBe(1)
        expect(calculateGoldCostFromTokens(1200, 'MODEL_GPT5_4_NANO')).toBe(1)
        expect(calculateGoldCostFromTokens(2400, 'MODEL_GPT5_4_NANO')).toBe(2)
        expect(calculateGoldCostFromTokens(500, 'MODEL_GPT5_6_LUNA')).toBe(1)
        expect(calculateGoldCostFromTokens(200, 'MODEL_GPT5_6_TERRA')).toBe(1)
    })

    test('defaults missing models to GPT-5.6 Sol with its full context window', () => {
        expect(normalizeModelKey()).toBe('MODEL_GPT5_6_SOL')
        expect(getMaxTokensForModel('MODEL_GPT5_6_SOL')).toBe(1050000)
    })

    test('returns the canonical URL when creating a note', async () => {
        const previousProjectId = process.env.GCLOUD_PROJECT
        process.env.GCLOUD_PROJECT = 'alldonealeph'
        mockCreateAndPersistNote.mockResolvedValue({
            success: true,
            noteId: 'note-1',
            message: 'Note created',
            note: {
                id: 'note-1',
                projectId: 'project-1',
                extendedTitle: 'Launch plan',
            },
        })

        try {
            const result = await executeToolNatively(
                'create_note',
                { title: 'Launch plan', content: '# Plan' },
                'project-1',
                null,
                'user-1',
                null
            )

            expect(result).toMatchObject({
                success: true,
                noteId: 'note-1',
                projectId: 'project-1',
                url: 'https://my.alldone.app/projects/project-1/notes/note-1/editor',
            })
        } finally {
            if (previousProjectId === undefined) delete process.env.GCLOUD_PROJECT
            else process.env.GCLOUD_PROJECT = previousProjectId
        }
    })

    test('adds a comment to a newly created topic chat', async () => {
        ProjectService.mockImplementationOnce(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([{ id: 'project-1', name: 'Inbox' }]),
        }))
        mockCollectionGet.mockResolvedValueOnce({ docs: [] })

        const result = await executeToolNatively(
            'add_chat_comment',
            {
                chatTitle: 'Daily email management 10.07.2027',
                comment: 'LINK: Email from Peter (peter@web.de): Peter sent the updated contract draft.',
                createIfMissing: true,
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(result).toMatchObject({
            success: true,
            projectId: 'project-1',
            projectName: 'Inbox',
            chatTitle: 'Daily email management 10.07.2027',
            chatCreated: true,
            skippedDuplicate: false,
        })
        expect(result.chatUrl).toContain('/projects/project-1/chats/')
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Daily email management 10.07.2027',
                type: 'topics',
                creatorId: 'user-1',
                assistantId: 'assistant-1',
                // Regression guard: the topic-creating write must seed the assistant as the
                // last-comment owner so the chat list never renders the first comment as
                // "Unknown user". Amount is set to 1 here (not incremented on top of the update).
                commentsData: expect.objectContaining({
                    amount: 1,
                    lastCommentOwnerId: 'assistant-1',
                    lastComment: 'LINK: Email from Peter (peter@web.de): Peter sent the updated contract draft.',
                }),
            })
        )
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                commentText: 'LINK: Email from Peter (peter@web.de): Peter sent the updated contract draft.',
                creatorId: 'assistant-1',
                fromAssistant: true,
                source: 'assistant_tool',
            })
        )
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                chatId: result.chatId,
                chatType: 'topics',
                followed: true,
                creatorId: 'assistant-1',
                creatorType: 'assistant',
            })
        )
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                usersFollowing: { __op: 'arrayUnion', values: ['user-1'] },
            }),
            { merge: true }
        )
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                topics: {
                    [result.chatId]: true,
                },
            }),
            { merge: true }
        )
    })

    test('uses the server-provided Gmail follow-up topic title', async () => {
        ProjectService.mockImplementationOnce(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([{ id: 'project-1', name: 'Inbox' }]),
        }))
        mockCollectionGet.mockResolvedValueOnce({ docs: [] })
        mockDocGet.mockResolvedValueOnce({ exists: false })

        const result = await executeToolNatively(
            'add_chat_comment',
            {
                chatId: 'wrong-chat-id',
                chatTitle: 'Daily emails Inbox 07.10.2026',
                comment: 'LINK: Email from Peter (peter@web.de): Peter sent the updated contract draft.',
                createIfMissing: false,
            },
            'project-1',
            'assistant-1',
            'user-1',
            null,
            {
                gmailContext: {
                    origin: 'gmail_label_follow_up',
                    topicChatTitle: 'Daily emails Inbox 10.07.2026',
                    gmailEmail: 'karsten@example.com',
                    connectionId: 'email_google_123',
                    connectionProjectId: 'connection-project-1',
                    messageId: 'message-1',
                    threadId: 'thread-1',
                    webUrl: 'https://mail.google.com/message-1',
                    followUpType: 'informational',
                },
            }
        )

        expect(result).toMatchObject({
            success: true,
            chatTitle: 'Daily emails Inbox 10.07.2026',
            chatCreated: true,
        })
        expect(mockDocSet).toHaveBeenCalledWith(expect.objectContaining({ title: 'Daily emails Inbox 10.07.2026' }))
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'gmail_label_follow_up',
                gmailData: expect.objectContaining({
                    connectionId: 'email_google_123',
                    projectId: 'connection-project-1',
                    connectionProjectId: 'connection-project-1',
                    messageId: 'message-1',
                    threadId: 'thread-1',
                }),
            })
        )
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                chatId: result.chatId,
                chatType: 'topics',
                followed: false,
                creatorId: 'assistant-1',
                creatorType: 'assistant',
            })
        )
    })

    test('keeps actionable Gmail chat notifications followed', async () => {
        ProjectService.mockImplementationOnce(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([{ id: 'project-1', name: 'Inbox' }]),
        }))
        mockCollectionGet.mockResolvedValueOnce({ docs: [] })
        mockDocGet.mockResolvedValueOnce({ exists: false })

        const result = await executeToolNatively(
            'add_chat_comment',
            {
                chatTitle: 'Action required',
                comment: 'Please review the failed payment.',
                createIfMissing: true,
            },
            'project-1',
            'assistant-1',
            'user-1',
            null,
            {
                gmailContext: {
                    origin: 'gmail_label_follow_up',
                    topicChatTitle: 'Action required',
                    messageId: 'message-actionable',
                    followUpType: 'actionable',
                },
            }
        )

        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                chatId: result.chatId,
                chatType: 'topics',
                followed: true,
                creatorId: 'assistant-1',
                creatorType: 'assistant',
            })
        )
    })

    test('requires exact tool URLs in follow-up responses', () => {
        expect(getToolResultFollowUpPrompt()).toContain('include that exact URL')
    })

    test('instructs link follow-ups to reuse the created note instead of creating another note', async () => {
        const messages = []

        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', ['create_note'])

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('reuse the exact note URL')
        expect(systemMessages).toContain('Never call create_note again merely to provide a link')
        expect(systemMessages).toContain('retrieve the existing note with get_notes or search')
    })

    test('uses a conversational style with natural humor across assistant channels', async () => {
        const messages = []

        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', [])

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('genuinely conversational companion')
        expect(systemMessages).toContain('light humor, playful observations, or a small joke')
        expect(systemMessages).toContain('never forced, repetitive, distracting, or insensitive')
        expect(systemMessages).not.toContain('occasionally use web_search without an explicit search request')
    })

    test('keeps volatile clock data after the internal reusable-prefix boundary', async () => {
        const messages = []

        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', [], 120)

        const breakpointIndex = messages.findIndex(message => message[2]?.promptCacheBreakpoint)
        const clockIndex = messages.findIndex(message => String(message[1]).startsWith('The current date and time'))

        expect(breakpointIndex).toBeGreaterThanOrEqual(0)
        expect(clockIndex).toBeGreaterThan(breakpointIndex)
        expect(typeof messages[breakpointIndex][1]).toBe('string')
    })

    test('allows restrained proactive research when web search is enabled', async () => {
        const messages = []

        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', ['web_search'])

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('occasionally use web_search without an explicit search request')
        expect(systemMessages).toContain('topic the user is genuinely interested in')
        expect(systemMessages).toContain('limited, occasional proactive web_search behavior')
    })

    test('commits a deferred silent-mode comment when the final reply is not HEARTBEAT_OK', async () => {
        mockDocGet.mockResolvedValue({ data: () => ({}) })

        const streamOutput = {}

        const result = await storeBotAnswerStream(
            'project-1',
            'topics',
            'chat-1',
            [
                {
                    clearThinkingMode: true,
                    replacementContent: 'Heartbeat reminder for the Daily WhatsApp topic.',
                },
            ],
            ['user-1'],
            ['PUBLIC'],
            null,
            'assistant-1',
            ['user-1'],
            'Anna',
            'user-1',
            null,
            [['user', 'Heartbeat prompt']],
            'MODEL_GPT5_5',
            'TEMPERATURE_NORMAL',
            [],
            {
                project: { name: 'Project A' },
                chat: { title: 'Daily Whatsapp <> Anna' },
                chatLink: 'https://my.alldone.app/projects/project-1/chats/chat-1/chat',
            },
            null,
            null,
            streamOutput,
            'HEARTBEAT_OK'
        )

        expect(result).toBe('Heartbeat reminder for the Daily WhatsApp topic.')
        expect(streamOutput.silentOk).not.toBe(true)
        expect(streamOutput.commentId).toBeTruthy()
        expect(mockDocSet).toHaveBeenCalledWith(
            expect.objectContaining({
                commentText: 'Heartbeat reminder for the Daily WhatsApp topic.',
                creatorId: 'assistant-1',
                fromAssistant: true,
            })
        )
        expect(mockDocUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                isLoading: false,
                isThinking: false,
            })
        )
    })

    test('adds timestamps to multimodal context content without dropping images', () => {
        expect(
            addTimestampToContextContent(
                [
                    { type: 'text', text: 'Please review this image' },
                    { type: 'image_url', image_url: { url: 'https://cdn.example.com/image.png' } },
                ],
                Date.UTC(2026, 2, 31, 8, 15, 0),
                60
            )
        ).toEqual([
            {
                type: 'text',
                text: '[Sent at 2026-03-31 09:15:00 UTC+1]\nPlease review this image',
            },
            { type: 'image_url', image_url: { url: 'https://cdn.example.com/image.png' } },
        ])
    })

    test('normalizes recentHours values for assistant task queries', () => {
        expect(normalizeRecentHours(2)).toBe(2)
        expect(normalizeRecentHours('2')).toBe(2)
        expect(normalizeRecentHours(0)).toBeNull()
        expect(normalizeRecentHours('nope')).toBeNull()
    })

    test('defaults assistant task scope to personal tasks', () => {
        expect(normalizeAssistantTaskScope()).toBe('mine')
        expect(normalizeAssistantTaskScope('mine')).toBe('mine')
        expect(normalizeAssistantTaskScope('visible')).toBe('visible')
        expect(normalizeAssistantTaskScope('team')).toBe('mine')
    })

    test('filters done tasks by the requested recent hour window', () => {
        const now = Date.UTC(2026, 2, 31, 16, 0, 0)

        expect(
            filterTasksByRecentHours(
                [
                    { id: 'recent', completed: now - 30 * 60 * 1000 },
                    { id: 'old', completed: now - 3 * 60 * 60 * 1000 },
                    { id: 'missing', completed: null },
                ],
                2,
                now
            )
        ).toEqual([{ id: 'recent', completed: now - 30 * 60 * 1000 }])
    })

    test('maps assistant task tool responses with completedAt preserved', () => {
        expect(
            mapAssistantTaskForToolResponse(
                {
                    documentId: 'task-1',
                    name: 'Follow up',
                    done: true,
                    completed: 1774970400000,
                    projectName: 'Alldone',
                    ownerUserId: 'user-1',
                    currentReviewerId: 'user-1',
                    isOwnedByRequestingUser: true,
                    dueDate: 1774974000000,
                    humanReadableId: 'AT-1',
                    sortIndex: 5,
                    parentGoal: 'goal-1',
                    calendarTime: '10:00',
                    comments: [
                        {
                            id: 'comment-1',
                            commentText: 'Need final approval',
                            created: 1774970000000,
                            creatorId: 'user-1',
                            fromAssistant: false,
                            commentType: 'STAYWARD_COMMENT',
                        },
                    ],
                    commentsData: {
                        amount: 1,
                        lastComment: 'Need final approval',
                    },
                    isFocus: true,
                },
                'user-1'
            )
        ).toEqual({
            id: 'task-1',
            name: 'Follow up',
            completed: true,
            completedAt: 1774970400000,
            projectName: 'Alldone',
            ownerUserId: 'user-1',
            currentReviewerId: 'user-1',
            isOwnedByRequestingUser: true,
            isCurrentReviewer: true,
            dueDate: 1774974000000,
            humanReadableId: 'AT-1',
            sortIndex: 5,
            priority: 'none',
            parentGoal: 'goal-1',
            calendarTime: '10:00',
            comments: [
                {
                    id: 'comment-1',
                    commentText: 'Need final approval',
                    created: 1774970000000,
                    creatorId: 'user-1',
                    fromAssistant: false,
                    commentType: 'STAYWARD_COMMENT',
                    isHistoricalContext: true,
                    isAssistantGenerated: false,
                },
            ],
            commentsData: {
                amount: 1,
                lastComment: 'Need final approval',
            },
            isFocus: true,
        })
    })

    test('marks assistant-authored task comments as historical non-authoritative context', () => {
        expect(
            mapAssistantTaskForToolResponse({
                documentId: 'task-2',
                name: 'Review execution logs',
                done: false,
                comments: [
                    {
                        id: 'comment-2',
                        commentText: 'Maximum tool call iterations reached',
                        created: 1774970500000,
                        creatorId: 'assistant-1',
                        fromAssistant: true,
                        commentType: 'STAYWARD_COMMENT',
                    },
                ],
            })
        ).toMatchObject({
            comments: [
                {
                    id: 'comment-2',
                    commentText: 'Maximum tool call iterations reached',
                    fromAssistant: true,
                    isHistoricalContext: true,
                    isAssistantGenerated: true,
                },
            ],
        })
    })

    test('maps assistant goal tool responses with active and done metadata preserved', () => {
        expect(
            mapAssistantGoalForToolResponse({
                id: 'goal-1',
                name: 'Launch v2',
                description: 'Ship the release',
                progress: 80,
                projectId: 'project-1',
                projectName: 'Product',
                ownerId: 'ALL_USERS',
                assigneesIds: ['user-1'],
                commentsData: {
                    amount: 2,
                    lastComment: 'Need the final review',
                },
                status: 'both',
                startingMilestoneDate: 1774970400000,
                completionMilestoneDate: 1775575200000,
                isBacklog: false,
                matchedMilestone: {
                    id: 'milestone-1',
                    date: 1774970400000,
                    extendedName: 'Sprint 1',
                    ownerId: 'ALL_USERS',
                },
                doneMilestones: [
                    {
                        milestoneId: 'done-1',
                        date: 1774365600000,
                        extendedName: 'Beta',
                        progress: 100,
                    },
                ],
                latestDoneMilestoneDate: 1774365600000,
            })
        ).toEqual({
            id: 'goal-1',
            name: 'Launch v2',
            description: 'Ship the release',
            progress: 80,
            projectId: 'project-1',
            projectName: 'Product',
            ownerId: 'ALL_USERS',
            assigneesIds: ['user-1'],
            commentsData: {
                amount: 2,
                lastComment: 'Need the final review',
            },
            status: 'both',
            startingMilestoneDate: 1774970400000,
            completionMilestoneDate: 1775575200000,
            isBacklog: false,
            matchedMilestone: {
                id: 'milestone-1',
                date: 1774970400000,
                extendedName: 'Sprint 1',
                ownerId: 'ALL_USERS',
            },
            doneMilestones: [
                {
                    milestoneId: 'done-1',
                    date: 1774365600000,
                    extendedName: 'Beta',
                    progress: 100,
                },
            ],
            latestDoneMilestoneDate: 1774365600000,
        })
    })

    test('redacts attachment base64 from conversation-safe tool results', () => {
        const toolResult = {
            success: true,
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
        }

        expect(buildConversationSafeToolResult('get_chat_attachment', toolResult)).toEqual({
            ...toolResult,
            fileBase64: '[omitted from conversation; preserved for the next external tool call]',
            fileBase64Length: toolResult.fileBase64.length,
        })
    })

    test('keeps non-attachment tool results unchanged', () => {
        const toolResult = { success: true, taskId: '123' }

        expect(buildConversationSafeToolResult('create_task', toolResult)).toBe(toolResult)
    })

    test('exposes only privacy-safe availability fields to the conversation', () => {
        expect(
            buildConversationSafeToolResult('find_calendar_availability', {
                success: true,
                timeZone: 'Europe/Berlin',
                durationMinutes: 30,
                requestedRange: {
                    start: '2026-03-10T09:00:00+01:00',
                    end: '2026-03-10T17:00:00+01:00',
                },
                workingHours: {
                    start: '09:00',
                    end: '17:00',
                    includeWeekends: false,
                },
                searchedCalendarCount: 2,
                failedCalendarCount: 0,
                providerAccount: 'private@example.com',
                options: [
                    {
                        start: '2026-03-10T11:00:00+01:00',
                        end: '2026-03-10T11:30:00+01:00',
                        conflictingEventTitle: 'Private meeting',
                    },
                ],
                message: 'Found 1 free meeting option.',
            })
        ).toEqual({
            success: true,
            timeZone: 'Europe/Berlin',
            durationMinutes: 30,
            requestedRange: {
                start: '2026-03-10T09:00:00+01:00',
                end: '2026-03-10T17:00:00+01:00',
            },
            workingHours: {
                start: '09:00',
                end: '17:00',
                includeWeekends: false,
            },
            options: [
                {
                    start: '2026-03-10T11:00:00+01:00',
                    end: '2026-03-10T11:30:00+01:00',
                },
            ],
            message: 'Found 1 free meeting option.',
        })
    })

    test('captures the full attachment payload for the next external tool call', () => {
        const toolResult = {
            success: true,
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
            messageId: 'msg-1',
        }

        expect(buildPendingAttachmentPayload('get_chat_attachment', toolResult)).toEqual({
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
            messageId: 'msg-1',
        })
    })

    test('redacts Gmail attachment base64 while preserving a Gmail source payload for the next tool call', () => {
        const toolResult = {
            success: true,
            fileName: 'invoice-from-gmail.pdf',
            fileBase64: 'Z21haWwtYnl0ZXM=',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 128,
            source: 'gmail',
            messageId: 'gmail-msg-1',
        }

        expect(buildConversationSafeToolResult('get_gmail_attachment', toolResult)).toEqual({
            ...toolResult,
            fileBase64: '[omitted from conversation; preserved for the next external tool call]',
            fileBase64Length: toolResult.fileBase64.length,
        })

        expect(buildPendingAttachmentPayload('get_gmail_attachment', toolResult)).toEqual({
            fileName: 'invoice-from-gmail.pdf',
            fileBase64: 'Z21haWwtYnl0ZXM=',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 128,
            source: 'gmail',
            messageId: 'gmail-msg-1',
        })
    })

    test('injects the pending attachment into external tool arguments when missing', () => {
        const pendingAttachmentPayload = {
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
        }

        expect(
            injectPendingAttachmentIntoToolArgs('external_tool_bookkeeping_send_invoice', {}, pendingAttachmentPayload)
        ).toEqual({
            toolArgs: {
                fileName: 'invoice.pdf',
                fileBase64: 'YWJjMTIz',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
            },
            usedPendingAttachment: true,
        })
    })

    test('replaces the redacted placeholder with the real pending attachment payload', () => {
        const pendingAttachmentPayload = {
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
        }

        expect(
            injectPendingAttachmentIntoToolArgs(
                'external_tool_bookkeeping_send_invoice',
                {
                    fileName: 'invoice.pdf',
                    fileBase64: '[omitted from conversation; preserved for the next external tool call]',
                },
                pendingAttachmentPayload
            )
        ).toEqual({
            toolArgs: {
                fileName: 'invoice.pdf',
                fileBase64: 'YWJjMTIz',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
            },
            usedPendingAttachment: true,
        })
    })

    test('replaces a truncated base64 value with the full pending attachment payload', () => {
        const pendingAttachmentPayload = {
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
        }

        expect(
            injectPendingAttachmentIntoToolArgs(
                'external_tool_bookkeeping_send_invoice',
                { fileName: 'invoice.pdf', fileBase64: 'YWJj' },
                pendingAttachmentPayload
            )
        ).toEqual({
            toolArgs: {
                fileName: 'invoice.pdf',
                fileBase64: 'YWJjMTIz',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
            },
            usedPendingAttachment: true,
        })
    })

    test('does not override file data already provided by the model', () => {
        const pendingAttachmentPayload = {
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'chat',
        }

        expect(
            injectPendingAttachmentIntoToolArgs(
                'external_tool_bookkeeping_send_invoice',
                { fileName: 'custom.pdf', fileBase64: 'ZGVmNDU2' },
                pendingAttachmentPayload
            )
        ).toEqual({
            toolArgs: {
                fileName: 'custom.pdf',
                fileBase64: 'ZGVmNDU2',
                fileMimeType: 'application/pdf',
                fileSizeBytes: 42,
                source: 'chat',
            },
            usedPendingAttachment: false,
        })
    })

    test('injects the pending attachment into Gmail draft attachment arguments', () => {
        const pendingAttachmentPayload = {
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'gmail',
        }

        expect(
            injectPendingAttachmentIntoToolArgs(
                'update_gmail_draft',
                {
                    draftId: 'draft-1',
                    attachments: [{ fileName: 'invoice.pdf' }],
                },
                pendingAttachmentPayload
            )
        ).toEqual({
            toolArgs: {
                draftId: 'draft-1',
                attachments: [
                    {
                        fileName: 'invoice.pdf',
                        mimeType: 'application/pdf',
                        base64: 'YWJjMTIz',
                    },
                ],
            },
            usedPendingAttachment: true,
        })
    })

    test('redacts Gmail draft attachment base64 from conversation-safe tool args', () => {
        const pendingAttachmentPayload = {
            fileName: 'invoice.pdf',
            fileBase64: 'YWJjMTIz',
            fileMimeType: 'application/pdf',
            fileSizeBytes: 42,
            source: 'gmail',
        }

        expect(
            buildConversationSafeToolArgs(
                'create_gmail_draft',
                {
                    attachments: [
                        {
                            fileName: 'invoice.pdf',
                            mimeType: 'application/pdf',
                            base64: 'YWJjMTIz',
                        },
                    ],
                },
                pendingAttachmentPayload
            )
        ).toEqual({
            attachments: [
                {
                    fileName: 'invoice.pdf',
                    mimeType: 'application/pdf',
                    base64: '[omitted from conversation; preserved for the next external tool call]',
                    base64Length: 8,
                },
            ],
        })
    })
})

describe('assistant create_task image helpers', () => {
    test('keeps description unchanged when images are omitted', () => {
        expect(mergeTaskDescriptionWithImages('Follow up with vendor', undefined)).toBe('Follow up with vendor')
    })

    test('builds description from images only when no description is provided', () => {
        const result = mergeTaskDescriptionWithImages('', ['https://cdn.example.com/uploads/receipt.png'])

        expect(result).toContain('https://cdn.example.com/uploads/receipt.png')
        expect(result).toContain('receipt.png')
    })

    test('appends image tokens after existing description text', () => {
        const result = mergeTaskDescriptionWithImages('Create expense task', [
            'https://cdn.example.com/uploads/receipt.png',
        ])

        expect(result.startsWith('Create expense task\n\n')).toBe(true)
        expect(result).toContain('https://cdn.example.com/uploads/receipt.png')
    })

    test('preserves multiple image URLs in order', () => {
        const result = buildCreateTaskImageTokens([
            'https://cdn.example.com/uploads/first.png',
            'https://cdn.example.com/uploads/second.png',
        ])

        expect(result.indexOf('first.png')).toBeLessThan(result.indexOf('second.png'))
    })

    test('ignores invalid, empty, and duplicate image URLs', () => {
        expect(
            normalizeCreateTaskImageUrls([
                '',
                '   ',
                'not-a-url',
                'https://cdn.example.com/uploads/a.png',
                'https://cdn.example.com/uploads/a.png',
                'http://cdn.example.com/uploads/b.png',
            ])
        ).toEqual(['https://cdn.example.com/uploads/a.png', 'http://cdn.example.com/uploads/b.png'])
    })

    test('extracts image URLs from multimodal message content', () => {
        expect(
            extractImageUrlsFromMessageContent([
                { type: 'text', text: 'Create a task from this' },
                { type: 'image_url', image_url: { url: 'https://cdn.example.com/uploads/a.png' } },
                { type: 'image_url', image_url: { url: 'https://cdn.example.com/uploads/b.png' } },
            ])
        ).toEqual(['https://cdn.example.com/uploads/a.png', 'https://cdn.example.com/uploads/b.png'])
    })

    test('injects current-message images into create_task args when the model omitted them', () => {
        expect(
            injectCurrentMessageImagesIntoCreateTaskArgs(
                'create_task',
                { name: 'Create a task', description: 'Bild aus dem Chat angehängt.' },
                {
                    content: [{ type: 'image_url', image_url: { url: 'https://cdn.example.com/uploads/a.png' } }],
                }
            )
        ).toEqual({
            toolArgs: {
                name: 'Create a task',
                description: 'Bild aus dem Chat angehängt.',
                images: ['https://cdn.example.com/uploads/a.png'],
            },
            usedCurrentMessageImages: true,
        })
    })
})

describe('assistant chat media helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        global.fetch = jest.fn()
    })

    test('extracts normalized media context from chat comment tokens', () => {
        const text =
            'Please review ' +
            'EbDsQTD14ahtSR5https://cdn.example.com/file.pdfEbDsQTD14ahtSR5invoice.pdfEbDsQTD14ahtSR5false ' +
            'and ' +
            'O2TI5plHBf1QfdYhttps://cdn.example.com/image.pngO2TI5plHBf1QfdYhttps://cdn.example.com/image-small.pngO2TI5plHBf1QfdYreceipt.pngO2TI5plHBf1QfdYfalse'

        expect(extractMediaContextFromText(text)).toEqual([
            {
                kind: 'file',
                fileName: 'invoice.pdf',
                mimeType: 'application/pdf',
                storageUrl: 'https://cdn.example.com/file.pdf',
                previewUrl: '',
                extractedText: '',
                extractionStatus: '',
            },
            {
                kind: 'image',
                fileName: 'receipt.png',
                mimeType: 'image/png',
                storageUrl: 'https://cdn.example.com/image.png',
                previewUrl: 'https://cdn.example.com/image-small.png',
                extractedText: '',
                extractionStatus: '',
            },
        ])
    })

    test('normalizes legacy processedMedia entries for assistant history', () => {
        expect(
            normalizeCommentMediaContext({
                processedMedia: [
                    {
                        kind: 'file',
                        fileName: 'notes.txt',
                        contentType: 'text/plain',
                        storageUrl: 'https://cdn.example.com/notes.txt',
                        extractedText: 'hello',
                        extractionStatus: 'extracted',
                    },
                ],
            })
        ).toEqual([
            {
                kind: 'file',
                fileName: 'notes.txt',
                mimeType: 'text/plain',
                storageUrl: 'https://cdn.example.com/notes.txt',
                previewUrl: '',
                extractedText: 'hello',
                extractionStatus: 'extracted',
            },
        ])
    })

    test('builds multimodal user content with file context for prior messages', () => {
        expect(
            buildUserMessageContentFromComment('See attached', [
                {
                    kind: 'file',
                    fileName: 'invoice.pdf',
                    mimeType: 'application/pdf',
                    storageUrl: 'https://cdn.example.com/file.pdf',
                    previewUrl: '',
                    extractedText: 'Invoice total is 120 EUR.',
                    extractionStatus: 'extracted',
                },
                {
                    kind: 'image',
                    fileName: 'receipt.png',
                    mimeType: 'image/png',
                    storageUrl: 'https://cdn.example.com/image.png',
                    previewUrl: 'https://cdn.example.com/image-small.png',
                    extractedText: '',
                    extractionStatus: '',
                },
            ])
        ).toEqual([
            {
                type: 'text',
                text: 'See attached\n\n[FILE: invoice.pdf, type=application/pdf]\nInvoice total is 120 EUR.',
            },
            {
                type: 'image_url',
                image_url: { url: 'https://cdn.example.com/image.png' },
            },
        ])
    })

    test('fetches a prior chat attachment from a referenced messageId', async () => {
        mockDocGet.mockResolvedValue({
            exists: true,
            data: () => ({
                fromAssistant: false,
                commentText: 'invoice',
                mediaContext: [
                    {
                        kind: 'file',
                        fileName: 'invoice.pdf',
                        mimeType: 'application/pdf',
                        storageUrl: 'https://cdn.example.com/file.pdf',
                    },
                ],
            }),
        })
        global.fetch.mockResolvedValue({
            ok: true,
            arrayBuffer: async () => Buffer.from('pdf-bytes'),
            headers: { get: jest.fn(() => 'application/pdf') },
        })

        await expect(
            getChatAttachmentForAssistantRequest({
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
                messageId: 'message-1',
                expectedFileName: 'invoice.pdf',
            })
        ).resolves.toEqual({
            success: true,
            fileName: 'invoice.pdf',
            fileBase64: Buffer.from('pdf-bytes').toString('base64'),
            fileMimeType: 'application/pdf',
            fileSizeBytes: Buffer.from('pdf-bytes').length,
            source: 'chat',
            messageId: 'message-1',
        })
    })

    test('allows chat attachments larger than 5 MB up to the new 10 MB limit', async () => {
        const buffer = Buffer.alloc(6 * 1024 * 1024, 1)

        mockDocGet.mockResolvedValue({
            exists: true,
            data: () => ({
                fromAssistant: false,
                commentText: 'invoice',
                mediaContext: [
                    {
                        kind: 'file',
                        fileName: 'invoice.pdf',
                        mimeType: 'application/pdf',
                        storageUrl: 'https://cdn.example.com/file.pdf',
                    },
                ],
            }),
        })
        global.fetch.mockResolvedValue({
            ok: true,
            arrayBuffer: async () => buffer,
            headers: { get: jest.fn(() => 'application/pdf') },
        })

        const result = await getChatAttachmentForAssistantRequest({
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            messageId: 'message-1',
            expectedFileName: 'invoice.pdf',
        })

        expect(result.success).toBe(true)
        expect(result.fileName).toBe('invoice.pdf')
        expect(result.fileMimeType).toBe('application/pdf')
        expect(result.fileSizeBytes).toBe(buffer.length)
        expect(result.fileBase64).toBe(buffer.toString('base64'))
    })

    test('falls back to a recent matching attachment when the current message has no file', async () => {
        mockDocGet.mockResolvedValue({
            exists: true,
            data: () => ({
                fromAssistant: false,
                commentText: 'Can you use the Tagesticket from earlier?',
                mediaContext: [],
            }),
        })
        mockCollectionGet.mockResolvedValue({
            docs: [
                {
                    id: 'message-old',
                    ref: { set: jest.fn(async () => {}) },
                    data: () => ({
                        created: 100,
                        fromAssistant: false,
                        mediaContext: [
                            {
                                kind: 'file',
                                fileName: 'Tagesticket.pdf',
                                mimeType: 'application/pdf',
                                storageUrl: 'https://cdn.example.com/tagesticket.pdf',
                            },
                        ],
                    }),
                },
            ],
        })
        global.fetch.mockResolvedValue({
            ok: true,
            arrayBuffer: async () => Buffer.from('ticket-bytes'),
            headers: { get: jest.fn(() => 'application/pdf') },
        })

        await expect(
            getChatAttachmentForAssistantRequest({
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
                messageId: 'message-current',
                explicitMessageIdProvided: false,
                userMessageText: 'Please send the Tagesticket from earlier.',
            })
        ).resolves.toEqual({
            success: true,
            fileName: 'Tagesticket.pdf',
            fileBase64: Buffer.from('ticket-bytes').toString('base64'),
            fileMimeType: 'application/pdf',
            fileSizeBytes: Buffer.from('ticket-bytes').length,
            source: 'chat',
            messageId: 'message-old',
        })
    })

    test('lists recent chat media with message ids and extracted-text availability', async () => {
        mockCollectionGet.mockResolvedValue({
            docs: [
                {
                    id: 'message-2',
                    ref: { set: jest.fn(async () => {}) },
                    data: () => ({
                        created: 200,
                        fromAssistant: false,
                        mediaContext: [
                            {
                                kind: 'file',
                                fileName: 'invoice.pdf',
                                mimeType: 'application/pdf',
                                storageUrl: 'https://cdn.example.com/file.pdf',
                                extractedText: 'Invoice total is 120 EUR.',
                            },
                        ],
                    }),
                },
                {
                    id: 'message-1',
                    ref: { set: jest.fn(async () => {}) },
                    data: () => ({
                        created: 100,
                        fromAssistant: false,
                        mediaContext: [
                            {
                                kind: 'image',
                                fileName: 'receipt.png',
                                mimeType: 'image/png',
                                storageUrl: 'https://cdn.example.com/image.png',
                            },
                        ],
                    }),
                },
            ],
        })

        await expect(
            listRecentChatMediaForAssistantRequest({
                projectId: 'project-1',
                objectType: 'topics',
                objectId: 'chat-1',
                limit: 10,
            })
        ).resolves.toEqual({
            success: true,
            items: [
                {
                    messageId: 'message-2',
                    created: 200,
                    kind: 'file',
                    fileName: 'invoice.pdf',
                    mimeType: 'application/pdf',
                    hasExtractedText: true,
                },
                {
                    messageId: 'message-1',
                    created: 100,
                    kind: 'image',
                    fileName: 'receipt.png',
                    mimeType: 'image/png',
                    hasExtractedText: false,
                },
            ],
        })
    })
})

describe('resolveCreateTaskTargetProject', () => {
    beforeEach(() => {
        ProjectService.mockClear()
    })

    test('falls back to the user default project when the requested project name does not exist', async () => {
        const getUserProjects = jest.fn().mockResolvedValue([{ id: 'p-context', name: 'Operations' }])
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects,
        }))

        const fakeDb = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(docId => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'users'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      defaultProjectId: 'p-default',
                                      projectIds: ['p-default', 'p-context'],
                                  }),
                              }
                            : collectionName === 'projects' && docId === 'p-default'
                            ? {
                                  exists: true,
                                  data: () => ({ name: 'Inbox' }),
                              }
                            : { exists: false, data: () => ({}) }
                    ),
                })),
            })),
            doc: jest.fn(path => ({ path })),
            getAll: jest.fn(async (...refs) =>
                refs.map(ref => ({
                    exists: ref.path === 'assistants/p-default/items/a-1',
                }))
            ),
        }

        await expect(
            resolveCreateTaskTargetProject(fakeDb, {
                creatorId: 'u-1',
                contextProjectId: 'p-context',
                assistantId: 'a-1',
                globalProjectId: 'global',
                requestedProjectName: 'Made Up Project',
            })
        ).resolves.toEqual({
            targetProjectId: 'p-default',
            targetProjectName: 'Inbox',
            source: 'defaultProjectFallback',
            reasoning: 'I could not find a project matching "Made Up Project", so I used your default project Inbox.',
        })

        expect(getUserProjects).toHaveBeenCalledWith('u-1', {
            includeArchived: false,
            includeCommunity: false,
        })
    })

    test('explains exact project-name matches', async () => {
        const getUserProjects = jest.fn().mockResolvedValue([{ id: 'p-client', name: 'Client Work' }])
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects,
        }))

        const fakeDb = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'users'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      defaultProjectId: 'p-default',
                                      projectIds: ['p-default', 'p-client'],
                                  }),
                              }
                            : { exists: false, data: () => ({}) }
                    ),
                })),
            })),
            doc: jest.fn(path => ({ path })),
            getAll: jest.fn(async (...refs) => refs.map(() => ({ exists: false }))),
        }

        await expect(
            resolveCreateTaskTargetProject(fakeDb, {
                creatorId: 'u-1',
                contextProjectId: 'p-context',
                assistantId: 'a-1',
                globalProjectId: 'global',
                requestedProjectName: 'Client Work',
            })
        ).resolves.toEqual({
            targetProjectId: 'p-client',
            targetProjectName: 'Client Work',
            source: 'toolArgs.projectName_exact',
            reasoning: 'The task creation request named "Client Work", which exactly matched Client Work.',
        })
    })

    test('keeps an exact project match when the reason negates the private project', async () => {
        const getUserProjects = jest.fn().mockResolvedValue([
            { id: 'p-private', name: 'Privat' },
            { id: 'p-alldone', name: 'Alldone Product' },
        ])
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects,
        }))
        const fakeDb = {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                })),
            })),
        }

        await expect(
            resolveCreateTaskTargetProject(fakeDb, {
                creatorId: 'u-1',
                contextProjectId: 'p-private',
                assistantId: 'a-1',
                globalProjectId: 'global',
                requestedProjectName: 'Alldone Product',
                assistantProjectRoutingReason:
                    'WhatsApp location handling is an Alldone product capability, not a private travel task.',
            })
        ).resolves.toMatchObject({
            targetProjectId: 'p-alldone',
            targetProjectName: 'Alldone Product',
            source: 'toolArgs.projectName_exact',
        })
    })

    test('does not redirect to a project that is explicitly negated', async () => {
        const getUserProjects = jest.fn().mockResolvedValue([
            { id: 'p-private', name: 'Privat' },
            { id: 'p-alldone', name: 'Alldone Product' },
        ])
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects,
        }))
        const fakeDb = {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                })),
            })),
        }

        await expect(
            resolveCreateTaskTargetProject(fakeDb, {
                creatorId: 'u-1',
                contextProjectId: 'p-private',
                assistantId: 'a-1',
                globalProjectId: 'global',
                requestedProjectName: 'Alldone Product',
                assistantProjectRoutingReason: 'This belongs to Alldone Product, not Privat.',
            })
        ).resolves.toMatchObject({
            targetProjectId: 'p-alldone',
            targetProjectName: 'Alldone Product',
            source: 'toolArgs.projectName_exact',
        })
    })

    test('corrects default-project fallback when low-confidence reason points to current context project', async () => {
        const getUserProjects = jest.fn().mockResolvedValue([
            { id: 'p-private', name: 'Privat' },
            { id: 'p-alldone', name: 'Alldone Product' },
        ])
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects,
        }))

        const fakeDb = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(docId => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'users'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      defaultProjectId: 'p-private',
                                      projectIds: ['p-private', 'p-alldone'],
                                  }),
                              }
                            : collectionName === 'projects' && docId === 'p-private'
                            ? {
                                  exists: true,
                                  data: () => ({ name: 'Privat' }),
                              }
                            : { exists: false, data: () => ({}) }
                    ),
                })),
            })),
            doc: jest.fn(path => ({ path })),
            getAll: jest.fn(async (...refs) =>
                refs.map(ref => ({
                    exists: ref.path === 'assistants/p-private/items/a-1',
                }))
            ),
        }

        await expect(
            resolveCreateTaskTargetProject(fakeDb, {
                creatorId: 'u-1',
                contextProjectId: 'p-alldone',
                assistantId: 'a-1',
                globalProjectId: 'global',
                requestedProjectName: 'Made Up Project',
                assistantProjectRoutingReason:
                    'Konzeptionelle Alldone-/Agenten-Produktidee mit direktem Bezug zu Heartbeats, Roadmaps und Task-Automation; gehört als Produktidee eher in das aktuelle Alldone-Kontextprojekt als in private Admin.',
                assistantProjectRoutingConfidence: 0,
            })
        ).resolves.toMatchObject({
            targetProjectId: 'p-alldone',
            targetProjectName: 'Alldone Product',
            source: 'routingConsistencyCorrection',
            routingConsistencyCorrection: {
                corrected: true,
                reason: 'assistant_reason_referenced_current_project',
                originalProjectId: 'p-private',
                correctedProjectId: 'p-alldone',
            },
        })
    })

    test('corrects explicit project id when reason contradicts it with another project name', async () => {
        const getUserProjects = jest.fn().mockResolvedValue([
            { id: 'p-private', name: 'Privat' },
            { id: 'p-alldone', name: 'Alldone Product' },
        ])
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects,
        }))

        const fakeDb = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(docId => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'projects' && docId === 'p-private'
                            ? {
                                  exists: true,
                                  data: () => ({ name: 'Privat' }),
                              }
                            : { exists: false, data: () => ({}) }
                    ),
                })),
            })),
        }

        await expect(
            resolveCreateTaskTargetProject(fakeDb, {
                creatorId: 'u-1',
                contextProjectId: 'p-private',
                assistantId: 'a-1',
                globalProjectId: 'global',
                requestedProjectId: 'p-private',
                assistantProjectRoutingReason: 'This belongs in Alldone Product rather than private admin.',
            })
        ).resolves.toMatchObject({
            targetProjectId: 'p-alldone',
            targetProjectName: 'Alldone Product',
            source: 'routingConsistencyCorrection',
            routingConsistencyCorrection: {
                corrected: true,
                reason: 'assistant_reason_projectName',
                originalProjectId: 'p-private',
                correctedProjectId: 'p-alldone',
            },
        })
    })
})

describe('assistant create_task project routing comments', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDocGet.mockReset()
        mockCreateAndPersistTask.mockReset()
        ProjectService.mockClear()
    })

    test('uses the assistant-provided project reason for the created task comment', async () => {
        const getUserProjects = jest.fn().mockResolvedValue([{ id: 'project-client', name: 'Client Work' }])
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects,
        }))
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    defaultProjectId: 'project-default',
                    projectIds: ['project-default', 'project-client'],
                    timezone: 'UTC+02:00',
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    defaultProjectId: 'project-default',
                    projectIds: ['project-default', 'project-client'],
                    timezone: 'UTC+02:00',
                }),
            })
        mockCreateAndPersistTask.mockResolvedValueOnce({
            success: true,
            taskId: 'task-1',
            projectId: 'project-client',
            message: 'Task created',
            task: {
                id: 'task-1',
                name: 'Follow up with client',
                userId: 'user-1',
                commentsData: { amount: 0 },
            },
        })

        const result = await executeToolNatively(
            'create_task',
            {
                name: 'Follow up with client',
                projectName: 'Client Work',
                recurrence: 'weekly',
                projectRoutingReason: 'the task is about the client onboarding discussion',
                projectRoutingConfidence: 0.84,
            },
            'project-default',
            'assistant-1',
            'user-1',
            null
        )

        expect(mockCreateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Follow up with client',
                projectId: 'project-client',
                recurrence: 'weekly',
            }),
            expect.objectContaining({
                userId: 'user-1',
                projectId: 'project-client',
            })
        )
        expect(addProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project-client',
                taskId: 'task-1',
                projectName: 'Client Work',
                reasoning: 'the task is about the client onboarding discussion',
                confidence: 0.84,
                source: 'assistant_create_task',
                routingData: expect.objectContaining({
                    assistantProvidedReasoning: true,
                    requestedProjectName: 'Client Work',
                }),
            })
        )
        expect(result.projectSelection).toMatchObject({
            reasoning: 'the task is about the client onboarding discussion',
            assistantProvidedReasoning: true,
            confidence: 0.84,
            commentId: 'routing-comment-1',
        })
    })

    test('creates task in corrected project when selected project conflicts with low-confidence reason', async () => {
        const getUserProjects = jest.fn().mockResolvedValue([
            { id: 'project-private', name: 'Privat' },
            { id: 'project-alldone', name: 'Alldone Product' },
        ])
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects,
        }))
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({ name: 'Privat' }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    defaultProjectId: 'project-private',
                    projectIds: ['project-private', 'project-alldone'],
                    timezone: 'UTC+02:00',
                }),
            })
        mockCreateAndPersistTask.mockResolvedValueOnce({
            success: true,
            taskId: 'task-alldone',
            projectId: 'project-alldone',
            message: 'Task created',
            task: {
                id: 'task-alldone',
                name: 'Agents, die sich wie Mitarbeiter benehmen',
                userId: 'user-1',
                commentsData: { amount: 0 },
            },
        })

        const result = await executeToolNatively(
            'create_task',
            {
                name: 'Agents, die sich wie Mitarbeiter benehmen',
                projectId: 'project-private',
                projectRoutingReason:
                    'Konzeptionelle Alldone-/Agenten-Produktidee mit direktem Bezug zu Heartbeats, Roadmaps und Task-Automation; gehört als Produktidee eher in das aktuelle Alldone-Kontextprojekt als in private Admin.',
                projectRoutingConfidence: 0,
            },
            'project-alldone',
            'assistant-1',
            'user-1',
            null
        )

        expect(mockCreateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Agents, die sich wie Mitarbeiter benehmen',
                projectId: 'project-alldone',
            }),
            expect.objectContaining({
                userId: 'user-1',
                projectId: 'project-alldone',
            })
        )
        expect(addProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project-alldone',
                taskId: 'task-alldone',
                projectName: 'Alldone Product',
                confidence: 0,
                routingData: expect.objectContaining({
                    selectionSource: 'routingConsistencyCorrection',
                    requestedProjectId: 'project-private',
                    contextProjectId: 'project-alldone',
                    routingConsistencyCorrection: expect.objectContaining({
                        corrected: true,
                        originalProjectId: 'project-private',
                        correctedProjectId: 'project-alldone',
                    }),
                }),
            })
        )
        expect(result.projectId).toBe('project-alldone')
        expect(result.projectSelection).toMatchObject({
            source: 'routingConsistencyCorrection',
            confidence: 0,
            routingConsistencyCorrection: {
                corrected: true,
                originalProjectId: 'project-private',
                correctedProjectId: 'project-alldone',
            },
        })
    })

    test('uses Gmail label matched project over conflicting assistant task project', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({ name: 'JTL Software - Project Juno' }),
            })
            .mockResolvedValue({
                exists: true,
                data: () => ({
                    defaultProjectId: 'project-bechtle',
                    projectIds: ['project-bechtle', 'project-jtl'],
                    timezone: 'UTC+02:00',
                }),
            })
        mockCreateAndPersistTask.mockResolvedValueOnce({
            success: true,
            taskId: 'task-jtl',
            projectId: 'project-jtl',
            message: 'Task created',
            task: {
                id: 'task-jtl',
                name: 'Bereitstellung der Rechnung 004 fuer JTL',
                userId: 'user-1',
                commentsData: { amount: 0 },
            },
        })

        const result = await executeToolNatively(
            'create_task',
            {
                name: 'Bereitstellung der Rechnung 004 fuer JTL',
                projectName: 'Bechtle',
                projectRoutingReason: 'the task is for Bechtle operations',
            },
            'project-bechtle',
            'assistant-1',
            'user-1',
            null,
            {
                projectId: 'project-bechtle',
                assistantId: 'assistant-1',
                requestUserId: 'user-1',
                gmailContext: {
                    origin: 'gmail_label_follow_up',
                    gmailEmail: 'karsten@example.com',
                    projectId: 'gmail-connection-project',
                    connectionProjectId: 'gmail-connection-project',
                    selectedProjectId: 'project-jtl',
                    messageId: 'message-1',
                    threadId: 'thread-1',
                    webUrl: 'https://mail.google.com/mail/u/0/#all/message-1',
                    archiveOnComplete: true,
                },
            }
        )

        expect(mockCreateAndPersistTask).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Bereitstellung der Rechnung 004 fuer JTL',
                projectId: 'project-jtl',
                gmailData: expect.objectContaining({
                    origin: 'gmail_label_follow_up',
                    projectId: 'gmail-connection-project',
                    taskProjectId: 'project-jtl',
                    selectedProjectId: 'project-jtl',
                    messageId: 'message-1',
                }),
            }),
            expect.objectContaining({
                userId: 'user-1',
                projectId: 'project-jtl',
            })
        )
        expect(result.projectId).toBe('project-jtl')
        expect(result.projectName).toBe('JTL Software - Project Juno')
        expect(result.projectSelection).toMatchObject({
            source: 'gmailLabelMatchedProject',
            reasoning:
                'The Gmail label classifier matched JTL Software - Project Juno, so I created the follow-up task there.',
            assistantProvidedReasoning: false,
        })
        expect(addProjectRoutingReasonComment).not.toHaveBeenCalled()
    })
})

describe('assistant get chats tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        ChatRetrievalService.mockClear()
    })

    test('delegates chat retrieval with normalized filters and timezone', async () => {
        const getChats = jest.fn().mockResolvedValue({
            chats: [
                {
                    documentId: 'chat-1',
                    projectId: 'project-2',
                    projectName: 'Marketing',
                    type: 'topics',
                    title: 'Weekly sync',
                    lastActivityAt: 1774970400000,
                    createdAt: 1774960000000,
                    lastCommentPreview: 'Need the new draft',
                    messages: [
                        {
                            messageId: 'message-1',
                            role: 'user',
                            text: 'Need the new draft',
                            createdAt: 1774970300000,
                            fromAssistant: false,
                        },
                    ],
                },
            ],
            count: 1,
            appliedFilters: {
                types: ['topics'],
                date: 'last week',
                limit: 10,
                projectId: 'project-2',
                projectName: 'Marketing',
            },
        })

        ChatRetrievalService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getChats,
        }))

        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                timezone: 'UTC+02:00',
            }),
        })

        const result = await executeToolNatively(
            'get_chats',
            {
                projectName: 'Marketing',
                date: 'last week',
                limit: 10,
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(getChats).toHaveBeenCalledWith({
            userId: 'user-1',
            projectId: '',
            projectName: 'Marketing',
            types: undefined,
            date: 'last week',
            limit: 10,
            timezoneOffset: 120,
        })
        expect(result).toMatchObject({
            count: 1,
            appliedFilters: {
                types: ['topics'],
                projectId: 'project-2',
                projectName: 'Marketing',
            },
        })
    })
})

describe('assistant get updates tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        UpdateRetrievalService.mockClear()
    })

    test('delegates update retrieval with normalized filters and timezone', async () => {
        const getUpdates = jest.fn().mockResolvedValue({
            updates: [
                {
                    id: 'feed-1',
                    projectId: 'project-2',
                    projectName: 'Marketing',
                    objectType: 'tasks',
                    objectId: 'task-1',
                    objectTitle: 'Launch checklist',
                    eventType: 'FEED_TASK_UPDATED',
                    eventText: 'updated task',
                    creatorId: 'user-2',
                    creatorName: 'Alice Example',
                    updatedAt: 1774970400000,
                },
            ],
            count: 1,
            appliedFilters: {
                allProjects: true,
                projectId: null,
                projectName: null,
                date: 'last 7 days',
                recentHours: null,
                actor: 'all',
                objectTypes: ['tasks'],
                limit: 50,
            },
            queriedProjects: [{ id: 'project-2', name: 'Marketing', type: 'regular' }],
        })

        UpdateRetrievalService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUpdates,
        }))

        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                timezone: 'UTC+02:00',
            }),
        })

        const result = await executeToolNatively(
            'get_updates',
            {
                date: 'last 7 days',
                objectTypes: ['tasks'],
                limit: 50,
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(getUpdates).toHaveBeenCalledWith({
            userId: 'user-1',
            currentProjectId: 'project-1',
            projectId: '',
            projectName: '',
            allProjects: true,
            includeArchived: false,
            includeCommunity: false,
            date: 'last 7 days',
            recentHours: undefined,
            actor: 'all',
            objectTypes: ['tasks'],
            limit: 50,
            timezoneOffset: 120,
        })
        expect(result).toMatchObject({
            count: 1,
            updates: [
                {
                    id: 'feed-1',
                    objectTitle: 'Launch checklist',
                    eventText: 'updated task',
                },
            ],
        })
    })
})

describe('assistant get tasks tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        TaskRetrievalService.mockClear()
        ProjectService.mockClear()
    })

    test('adds top-level interpretation metadata and labels historical task comments', async () => {
        const getTasksFromMultipleProjects = jest.fn().mockResolvedValue({
            tasks: [
                {
                    id: 'task-1',
                    documentId: 'task-1',
                    name: 'Weekly Project descriptions update',
                    done: true,
                    completed: 1774970400000,
                    projectName: 'Privat',
                    humanReadableId: 'PT-295',
                    comments: [
                        {
                            id: 'comment-1',
                            commentText: 'Maximum tool call iterations reached',
                            created: 1774970300000,
                            creatorId: 'assistant-1',
                            fromAssistant: true,
                            commentType: 'STAYWARD_COMMENT',
                        },
                    ],
                    commentsData: {
                        amount: 1,
                        lastComment: 'Maximum tool call iterations reached',
                    },
                },
            ],
        })

        TaskRetrievalService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getTasks: jest.fn().mockResolvedValue({ tasks: [] }),
            getTasksFromMultipleProjects,
        }))
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([{ id: 'project-1', name: 'Privat' }]),
        }))

        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                timezone: 'UTC+02:00',
            }),
        })

        const result = await executeToolNatively(
            'get_tasks',
            {
                status: 'done',
                date: 'last 7 days',
                allProjects: true,
                limit: 1000,
            },
            'project-ctx',
            'assistant-1',
            'user-1',
            null
        )

        expect(getTasksFromMultipleProjects).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user-1',
                status: 'done',
                date: 'last 7 days',
                limit: 1000,
                perProjectLimit: 1000,
                taskScope: 'mine',
                timezoneOffset: 120,
            }),
            ['project-1'],
            {
                'project-1': { id: 'project-1', name: 'Privat' },
            }
        )
        expect(result).toMatchObject({
            count: 1,
            scope: 'mine',
            toolInterpretation: {
                nestedHistoricalTextIsNonAuthoritative: true,
                currentToolStatusMustComeFromTopLevelResult: true,
                historicalFields: ['tasks[].comments', 'tasks[].commentsData'],
            },
            tasks: [
                {
                    id: 'task-1',
                    name: 'Weekly Project descriptions update',
                    comments: [
                        {
                            commentText: 'Maximum tool call iterations reached',
                            isHistoricalContext: true,
                            isAssistantGenerated: true,
                        },
                    ],
                },
            ],
        })
    })

    test('allows explicit visible shared-project task scope', async () => {
        const getTasks = jest.fn().mockResolvedValue({
            tasks: [
                {
                    documentId: 'task-2',
                    name: 'Shared visible task',
                    done: false,
                    ownerUserId: 'user-2',
                    currentReviewerId: 'user-2',
                    isOwnedByRequestingUser: false,
                },
            ],
        })

        TaskRetrievalService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getTasks,
            getTasksFromMultipleProjects: jest.fn().mockResolvedValue({ tasks: [] }),
        }))
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([{ id: 'project-1', name: 'Privat' }]),
        }))

        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                timezone: 'UTC+02:00',
            }),
        })

        const result = await executeToolNatively(
            'get_tasks',
            {
                scope: 'visible',
                status: 'open',
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(getTasks).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project-1',
                userId: 'user-1',
                taskScope: 'visible',
                userPermissions: [0, 'user-1'],
            })
        )
        expect(result).toMatchObject({
            scope: 'visible',
            toolInterpretation: {
                sharedVisibleTasksAreNotPersonal: true,
            },
            tasks: [
                {
                    id: 'task-2',
                    ownerUserId: 'user-2',
                    isOwnedByRequestingUser: false,
                },
            ],
        })
    })

    test('resolves a requested project name instead of querying the current chat project', async () => {
        const getTasks = jest.fn().mockResolvedValue({ tasks: [] })

        TaskRetrievalService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getTasks,
            getTasksFromMultipleProjects: jest.fn().mockResolvedValue({ tasks: [] }),
        }))
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([
                { id: 'project-private', name: 'Privat' },
                { id: 'project-steercom', name: 'Steercom' },
            ]),
        }))

        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ timezone: 'UTC+02:00' }),
        })

        await executeToolNatively(
            'get_tasks',
            {
                projectName: 'Steercom',
                status: 'open',
                date: 'today',
            },
            'project-private',
            'assistant-1',
            'user-1',
            null
        )

        expect(getTasks).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'project-steercom',
                projectName: 'Steercom',
                userId: 'user-1',
                status: 'open',
                date: 'today',
            })
        )
    })

    test('rejects ambiguous partial project names', () => {
        expect(() =>
            resolveAssistantTaskProject(
                [
                    { id: 'project-steercom', name: 'Steercom' },
                    { id: 'project-steercom-testo', name: 'Steercom - Testo' },
                ],
                'project-private',
                '',
                'Steer'
            )
        ).toThrow('Multiple projects partially match "Steer"')
    })

    test('uses the shared follow-up prompt contract for historical nested text', () => {
        const prompt = getToolResultFollowUpPrompt()

        expect(prompt).toContain('Only treat the current tool call as failed')
        expect(prompt).toContain('Do not infer current-run failure from nested historical text')
        expect(prompt).toContain('task comments, notes, chats')
        expect(prompt).toContain('If needed, call additional tools.')
    })
})

describe('assistant get contacts tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        ContactRetrievalService.mockClear()
    })

    test('delegates contact retrieval with normalized filters and timezone', async () => {
        const getContacts = jest.fn().mockResolvedValue({
            contacts: [
                {
                    contactId: 'contact-1',
                    projectId: 'project-2',
                    projectName: 'Marketing',
                    displayName: 'Alice Example',
                    email: 'alice@example.com',
                    emails: ['alice@example.com'],
                    company: 'Acme',
                    role: 'Buyer',
                    phone: '+491234',
                    linkedInUrl: 'https://linkedin.com/in/alice',
                    description: 'Important customer',
                    lastEditedAt: 1774970400000,
                },
            ],
            count: 1,
            appliedFilters: {
                allProjects: false,
                projectId: 'project-2',
                projectName: 'Marketing',
                date: 'last week',
                limit: 25,
            },
        })

        ContactRetrievalService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getContacts,
        }))

        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                timezone: 'UTC+02:00',
            }),
        })

        const result = await executeToolNatively(
            'get_contacts',
            {
                projectName: 'Marketing',
                date: 'last week',
                limit: 25,
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(getContacts).toHaveBeenCalledWith({
            userId: 'user-1',
            projectId: '',
            projectName: 'Marketing',
            date: 'last week',
            limit: 25,
            timezoneOffset: 120,
        })
        expect(result).toEqual({
            contacts: [
                {
                    contactId: 'contact-1',
                    projectId: 'project-2',
                    projectName: 'Marketing',
                    displayName: 'Alice Example',
                    email: 'alice@example.com',
                    emails: ['alice@example.com'],
                    company: 'Acme',
                    role: 'Buyer',
                    phone: '+491234',
                    linkedInUrl: 'https://linkedin.com/in/alice',
                    description: 'Important customer',
                    lastEditedAt: 1774970400000,
                },
            ],
            count: 1,
            appliedFilters: {
                allProjects: false,
                projectId: 'project-2',
                projectName: 'Marketing',
                date: 'last week',
                limit: 25,
            },
        })
    })
})

describe('assistant get project happiness tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        ProjectService.mockClear()
    })

    test('returns private happiness entries and stats across projects', async () => {
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([{ id: 'project-1', name: 'Privat' }]),
        }))

        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                timezone: 'UTC+02:00',
            }),
        })
        mockCollectionGet.mockResolvedValueOnce({
            docs: [
                {
                    id: '20260401',
                    data: () => ({
                        projectId: 'project-1',
                        userId: 'user-1',
                        dateKey: '20260401',
                        day: 20260401,
                        timestamp: 1775001600000,
                        rating: 5,
                        comment: 'Deep work on the launch felt energizing.',
                        updated: 1775088000000,
                    }),
                },
                {
                    id: '20260331',
                    data: () => ({
                        projectId: 'project-1',
                        userId: 'user-1',
                        dateKey: '20260331',
                        day: 20260331,
                        timestamp: 1774915200000,
                        rating: 2,
                        comment: 'Too many interruptions.',
                    }),
                },
            ],
        })

        const result = await executeToolNatively(
            'get_project_happiness',
            {
                allProjects: true,
                limit: 20,
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(ProjectService).toHaveBeenCalled()
        expect(result).toMatchObject({
            count: 2,
            entries: [
                {
                    projectId: 'project-1',
                    projectName: 'Privat',
                    rating: 5,
                    ratingText: '5/5 very happy',
                    comment: 'Deep work on the launch felt energizing.',
                },
                {
                    projectId: 'project-1',
                    projectName: 'Privat',
                    rating: 2,
                    ratingText: '2/5 unhappy',
                    comment: 'Too many interruptions.',
                },
            ],
            stats: {
                count: 2,
                averageRating: 3.5,
                distribution: {
                    1: 0,
                    2: 1,
                    3: 0,
                    4: 0,
                    5: 1,
                },
            },
            appliedFilters: {
                allProjects: true,
                limit: 20,
                timezoneOffset: 120,
            },
            privacy: 'Project happiness entries are private to the requesting user.',
        })
        expect(result.stats.happiestEntries).toHaveLength(1)
        expect(result.stats.unhappiestEntries).toHaveLength(1)
    })
})

describe('assistant get goals tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        GoalRetrievalService.mockClear()
    })

    test('delegates goal retrieval with default active cross-project filters', async () => {
        const getGoals = jest.fn().mockResolvedValue({
            goals: [
                {
                    id: 'goal-1',
                    name: 'Launch v2',
                    description: '',
                    progress: 80,
                    projectId: 'project-2',
                    projectName: 'Marketing',
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    commentsData: null,
                    status: 'active',
                    startingMilestoneDate: 1774970400000,
                    completionMilestoneDate: 1775575200000,
                    isBacklog: false,
                },
            ],
            count: 1,
            appliedFilters: {
                status: 'active',
                allProjects: true,
                projectId: null,
                projectName: null,
                currentMilestoneOnly: false,
                limit: 100,
            },
        })

        GoalRetrievalService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getGoals,
        }))

        const result = await executeToolNatively('get_goals', {}, 'project-1', 'assistant-1', 'user-1', null)

        expect(getGoals).toHaveBeenCalledWith({
            userId: 'user-1',
            currentProjectId: 'project-1',
            projectId: '',
            projectName: '',
            allProjects: true,
            status: 'active',
            currentMilestoneOnly: false,
            limit: undefined,
        })
        expect(result).toMatchObject({
            count: 1,
            appliedFilters: {
                status: 'active',
                allProjects: true,
            },
            goals: [
                expect.objectContaining({
                    id: 'goal-1',
                    status: 'active',
                    projectName: 'Marketing',
                }),
            ],
        })
    })

    test('forwards projectName and currentMilestoneOnly and maps merged all-status results', async () => {
        const getGoals = jest.fn().mockResolvedValue({
            goals: [
                {
                    id: 'goal-2',
                    name: 'Document rollout',
                    description: 'Write the launch guide',
                    progress: 100,
                    projectId: 'project-3',
                    projectName: 'Product',
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    commentsData: { amount: 1, lastComment: 'Done' },
                    status: 'both',
                    startingMilestoneDate: 1774970400000,
                    completionMilestoneDate: 1775575200000,
                    isBacklog: false,
                    matchedMilestone: {
                        id: 'milestone-2',
                        date: 1774970400000,
                        extendedName: 'Sprint 2',
                        ownerId: 'ALL_USERS',
                    },
                    doneMilestones: [
                        {
                            milestoneId: 'done-2',
                            date: 1774365600000,
                            extendedName: 'Beta',
                            progress: 100,
                        },
                    ],
                    latestDoneMilestoneDate: 1774365600000,
                },
            ],
            count: 1,
            appliedFilters: {
                status: 'all',
                allProjects: false,
                projectId: 'project-3',
                projectName: 'Product',
                currentMilestoneOnly: true,
                limit: 20,
            },
        })

        GoalRetrievalService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getGoals,
        }))

        const result = await executeToolNatively(
            'get_goals',
            {
                status: 'all',
                projectName: 'Product',
                currentMilestoneOnly: true,
                limit: 20,
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(getGoals).toHaveBeenCalledWith({
            userId: 'user-1',
            currentProjectId: 'project-1',
            projectId: '',
            projectName: 'Product',
            allProjects: true,
            status: 'all',
            currentMilestoneOnly: true,
            limit: 20,
        })
        expect(result.goals).toEqual([
            expect.objectContaining({
                id: 'goal-2',
                status: 'both',
                matchedMilestone: expect.objectContaining({
                    id: 'milestone-2',
                }),
                doneMilestones: [
                    expect.objectContaining({
                        milestoneId: 'done-2',
                    }),
                ],
            }),
        ])
    })
})

describe('assistant heartbeat settings tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDocGet.mockReset()
        mockTransactionGet.mockClear()
        mockTransactionUpdate.mockClear()
    })

    test('builds heartbeat settings context with the current prompt', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    isDefault: true,
                    heartbeatIntervalMs: 20 * 60 * 1000,
                    heartbeatChancePercent: 25,
                    heartbeatAwakeStart: 9 * 60 * 60 * 1000,
                    heartbeatAwakeEnd: 18 * 60 * 60 * 1000,
                    heartbeatSendWhatsApp: true,
                    heartbeatPrompt: 'Current heartbeat prompt.',
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(getHeartbeatSettingsContextMessage('project-1', 'assistant-1')).resolves.toContain(
            'Current heartbeat prompt.'
        )
    })

    test('injects current heartbeat settings and prompt-edit guidance into base instructions', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    name: 'Operations',
                    description: '',
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    heartbeatIntervalMs: 20 * 60 * 1000,
                    heartbeatChancePercent: 45,
                    heartbeatAwakeStart: 9 * 60 * 60 * 1000,
                    heartbeatAwakeEnd: 18 * 60 * 60 * 1000,
                    heartbeatSendWhatsApp: false,
                    heartbeatPrompt: 'Check progress and mention the focus task.',
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        const messages = []
        await addBaseInstructions(messages, 'Heartbeat Bot', 'en', 'Be helpful.', ['update_heartbeat_settings'], null, {
            projectId: 'project-1',
            assistantId: 'assistant-1',
        })

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('Current heartbeat settings for this assistant:')
        expect(systemMessages).toContain('Check progress and mention the focus task.')
        expect(systemMessages).toContain('treat the current heartbeat prompt as the base text')
    })

    test('denies heartbeat settings tool execution when not allowed', async () => {
        expect(await isToolAllowedForExecution([], 'update_heartbeat_settings')).toBe(false)
        expect(await isToolAllowedForExecution(['update_heartbeat_settings'], 'update_heartbeat_settings')).toBe(true)
    })

    test('updates heartbeat settings with normalized values', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_heartbeat_settings'],
                    heartbeatPrompt: 'Old prompt',
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_heartbeat_settings'],
                    heartbeatPrompt: 'Old prompt',
                    heartbeatPromptHistory: Array.from({ length: 10 }, (_, index) => ({
                        prompt: `Older heartbeat prompt ${index}`,
                        heartbeatPrompt: `Older heartbeat prompt ${index}`,
                        replacedAt: 100 - index,
                    })),
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    defaultProjectId: 'project-1',
                    phone: '+49123456',
                }),
            })

        const result = await executeToolNatively(
            'update_heartbeat_settings',
            {
                intervalMinutes: 17,
                chancePercent: 120,
                awakeStartTime: '09:15',
                awakeEndTime: '18:45',
                sendWhatsApp: false,
                prompt: '  New prompt for heartbeat  ',
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(mockTransactionUpdate).toHaveBeenCalledWith(expect.any(Object), {
            heartbeatIntervalMs: 15 * 60 * 1000,
            heartbeatChancePercent: 100,
            heartbeatAwakeStart: (9 * 60 + 15) * 60 * 1000,
            heartbeatAwakeEnd: (18 * 60 + 45) * 60 * 1000,
            heartbeatSendWhatsApp: false,
            heartbeatPrompt: 'New prompt for heartbeat',
            heartbeatPromptHistory: expect.arrayContaining([
                expect.objectContaining({
                    prompt: 'Old prompt',
                    heartbeatPrompt: 'Old prompt',
                    replacedByUserId: 'user-1',
                    replacedByAssistantId: 'assistant-1',
                }),
            ]),
            lastEditorId: 'user-1',
            lastEditionDate: expect.any(Number),
        })
        const updatePatch = mockTransactionUpdate.mock.calls[0][1]
        expect(updatePatch.heartbeatPromptHistory).toHaveLength(10)
        expect(result).toMatchObject({
            success: true,
            assistantId: 'assistant-1',
            updatedFields: [
                'intervalMinutes',
                'chancePercent',
                'awakeStartTime',
                'awakeEndTime',
                'sendWhatsApp',
                'prompt',
            ],
            heartbeatPrompt: 'New prompt for heartbeat',
            heartbeatPromptHistoryLength: 10,
        })
        expect(result.heartbeatSettings).toMatchObject({
            intervalMinutes: 15,
            chancePercent: 100,
            awakeStartTime: '09:15',
            awakeEndTime: '18:45',
            sendWhatsApp: false,
            prompt: 'New prompt for heartbeat',
        })
    })

    test('rejects heartbeat settings updates without writable fields', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    allowedTools: ['update_heartbeat_settings'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively('update_heartbeat_settings', {}, 'project-1', 'assistant-1', 'user-1', null)
        ).rejects.toThrow('update_heartbeat_settings requires at least one')
    })

    test('does not create heartbeat prompt history when the prompt is unchanged', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_heartbeat_settings'],
                    heartbeatPrompt: 'Same prompt',
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'update_heartbeat_settings',
                { prompt: 'Same prompt' },
                'project-1',
                'assistant-1',
                'user-1',
                null
            )
        ).rejects.toThrow('update_heartbeat_settings requires at least one')
        expect(mockTransactionUpdate).not.toHaveBeenCalled()
        expect(mockDocUpdate).not.toHaveBeenCalled()
    })

    test('rejects invalid heartbeat time strings', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    allowedTools: ['update_heartbeat_settings'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'update_heartbeat_settings',
                { awakeStartTime: '9am' },
                'project-1',
                'assistant-1',
                'user-1',
                null
            )
        ).rejects.toThrow('awakeStartTime must use HH:mm format.')
    })

    test('rejects direct heartbeat settings execution when the tool is not permitted', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    allowedTools: [],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'update_heartbeat_settings',
                { chancePercent: 40 },
                'project-1',
                'assistant-1',
                'user-1',
                null
            )
        ).rejects.toThrow('Tool not permitted: update_heartbeat_settings')
    })
})

describe('assistant settings prompt history', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDocGet.mockReset()
        mockTransactionGet.mockClear()
        mockTransactionUpdate.mockClear()
    })

    test('updates the current default-project assistant when its id is explicitly repeated', async () => {
        const assistant = {
            uid: 'assistant-1',
            allowedTools: ['update_assistant_settings'],
            instructions: 'Current instructions',
        }
        const missingDoc = { exists: false, data: () => ({}) }
        const userDoc = {
            exists: true,
            data: () => ({ defaultProjectId: 'default-project' }),
        }
        const assistantDoc = { exists: true, data: () => assistant }

        mockDocGet
            // Resolve and authorize the caller.
            .mockResolvedValueOnce(missingDoc)
            .mockResolvedValueOnce(missingDoc)
            .mockResolvedValueOnce(userDoc)
            .mockResolvedValueOnce(assistantDoc)
            // Resolve the implicit self-update target.
            .mockResolvedValueOnce(missingDoc)
            .mockResolvedValueOnce(missingDoc)
            .mockResolvedValueOnce(userDoc)
            .mockResolvedValueOnce(assistantDoc)
            // Re-read the target inside the update transaction.
            .mockResolvedValueOnce(assistantDoc)

        const result = await executeToolNatively(
            'update_assistant_settings',
            { assistantId: 'assistant-1', instructions: 'Updated instructions' },
            'chat-project',
            'assistant-1',
            'user-1',
            null
        )

        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'assistants/default-project/items/assistant-1' }),
            expect.objectContaining({ instructions: 'Updated instructions' })
        )
        expect(result).toMatchObject({
            success: true,
            assistantId: 'assistant-1',
            targetProjectId: 'default-project',
            isSelf: true,
        })
    })

    test('finds an explicitly targeted assistant in another accessible project', async () => {
        const callerAssistant = {
            uid: 'assistant-1',
            allowedTools: ['update_assistant_settings'],
            instructions: 'Caller instructions',
        }
        const targetAssistant = {
            uid: 'assistant-2',
            instructions: 'Target instructions',
        }
        const missingDoc = { exists: false, data: () => ({}) }

        mockDocGet
            // Resolve and authorize the caller from the chat project.
            .mockResolvedValueOnce({ exists: true, data: () => callerAssistant })
            .mockResolvedValueOnce(missingDoc)
            // Load the projects accessible to the requesting user.
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({ projectIds: ['chat-project', 'target-project'] }),
            })
            // Search chat, global, then the other accessible project.
            .mockResolvedValueOnce(missingDoc)
            .mockResolvedValueOnce(missingDoc)
            .mockResolvedValueOnce({ exists: true, data: () => targetAssistant })
            // Re-read the target inside the update transaction.
            .mockResolvedValueOnce({ exists: true, data: () => targetAssistant })

        const result = await executeToolNatively(
            'update_assistant_settings',
            { assistantId: 'assistant-2', description: 'Updated target description' },
            'chat-project',
            'assistant-1',
            'user-1',
            null
        )

        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'assistants/target-project/items/assistant-2' }),
            expect.objectContaining({ description: 'Updated target description' })
        )
        expect(result).toMatchObject({
            success: true,
            targetProjectId: 'target-project',
            isSelf: false,
        })
    })

    test('versions instructions changes and caps history at 10 entries', async () => {
        const existingHistory = Array.from({ length: 10 }, (_, index) => ({
            prompt: `Older instructions ${index}`,
            instructions: `Older instructions ${index}`,
            replacedAt: 100 - index,
        }))

        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_assistant_settings'],
                    instructions: 'Current instructions',
                    instructionsHistory: existingHistory,
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_assistant_settings'],
                    instructions: 'Current instructions',
                    instructionsHistory: existingHistory,
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_assistant_settings'],
                    instructions: 'Current instructions',
                    instructionsHistory: existingHistory,
                }),
            })

        const result = await executeToolNatively(
            'update_assistant_settings',
            { instructions: 'Updated instructions' },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                instructions: 'Updated instructions',
                instructionsHistory: expect.arrayContaining([
                    expect.objectContaining({
                        prompt: 'Current instructions',
                        instructions: 'Current instructions',
                        replacedByUserId: 'user-1',
                        replacedByAssistantId: 'assistant-1',
                    }),
                ]),
                lastEditorId: 'user-1',
                lastEditionDate: expect.any(Number),
            })
        )
        const updatePatch = mockTransactionUpdate.mock.calls[0][1]
        expect(updatePatch.instructionsHistory).toHaveLength(10)
        expect(result).toMatchObject({
            success: true,
            updatedFields: ['instructions'],
            instructionsHistoryLength: 10,
        })
    })

    test('updates the assistant realtime call voice explicitly', async () => {
        const assistant = {
            uid: 'assistant-1',
            allowedTools: ['update_assistant_settings'],
            instructions: 'Current instructions',
            realtimeVoice: 'marin',
        }
        mockDocGet
            .mockResolvedValueOnce({ exists: true, data: () => assistant })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })
            .mockResolvedValueOnce({ exists: true, data: () => assistant })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })
            .mockResolvedValueOnce({ exists: true, data: () => assistant })

        const result = await executeToolNatively(
            'update_assistant_settings',
            { realtimeVoice: 'cedar' },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                realtimeVoice: 'cedar',
                lastEditorId: 'user-1',
                lastEditionDate: expect.any(Number),
            })
        )
        expect(result).toMatchObject({
            success: true,
            updatedFields: ['realtimeVoice'],
        })
    })
})

describe('assistant thread compaction tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDocGet.mockReset()
        mockDocSet.mockClear()
        mockCollectionGet.mockReset()
    })

    test('injects compaction guidance into base instructions when allowed', async () => {
        mockDocGet.mockResolvedValue({
            exists: false,
            data: () => ({}),
        })

        const messages = []
        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', ['compact_thread_context'], null, {
            projectId: 'project-1',
            assistantId: 'assistant-1',
            objectType: 'topics',
            objectId: 'chat-1',
        })

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('use compact_thread_context after finishing a unit')
        expect(systemMessages).toContain('compacted working memory')
    })

    test('does not inject compaction guidance without a thread-backed runtime context', async () => {
        mockDocGet.mockResolvedValue({
            exists: false,
            data: () => ({}),
        })

        const messages = []
        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', ['compact_thread_context'], null, {
            projectId: 'project-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).not.toContain('use compact_thread_context after finishing a unit')
        expect(systemMessages).not.toContain('compacted working memory')
    })

    test('denies compact_thread_context execution without a thread-backed runtime context', async () => {
        expect(await isToolAllowedForExecution(['compact_thread_context'], 'compact_thread_context')).toBe(false)
        expect(
            await isToolAllowedForExecution(['compact_thread_context'], 'compact_thread_context', {
                projectId: 'project-1',
                assistantId: 'assistant-1',
            })
        ).toBe(false)
        expect(
            await isToolAllowedForExecution(['compact_thread_context'], 'compact_thread_context', {
                projectId: 'project-1',
                assistantId: 'assistant-1',
                objectType: 'topics',
                objectId: 'chat-1',
            })
        ).toBe(true)
    })

    test('persists hidden assistant thread state for compact_thread_context', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1710000000000)

        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['compact_thread_context'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        const result = await executeToolNatively(
            'compact_thread_context',
            {
                summary: 'Finished Operations. Marketing is next.',
                progressCompleted: 1,
                progressTotal: 3,
                currentProjectId: 'project-1',
                currentProjectName: 'Operations',
                nextProjectId: 'project-2',
                nextProjectName: 'Marketing',
            },
            'project-1',
            'assistant-1',
            'user-1',
            null,
            {
                projectId: 'project-1',
                assistantId: 'assistant-1',
                objectType: 'topics',
                objectId: 'chat-1',
            }
        )

        expect(mockDocSet).toHaveBeenCalledWith({
            summary: 'Finished Operations. Marketing is next.',
            progressCompleted: 1,
            progressTotal: 3,
            currentProjectId: 'project-1',
            currentProjectName: 'Operations',
            nextProjectId: 'project-2',
            nextProjectName: 'Marketing',
            trimHistoryBeforeMs: 1710000000000,
            updatedAt: expect.any(Object),
        })
        expect(result).toMatchObject({
            success: true,
            projectId: 'project-1',
            objectType: 'topics',
            objectId: 'chat-1',
            assistantId: 'assistant-1',
            compactedState: {
                summary: 'Finished Operations. Marketing is next.',
                progressCompleted: 1,
                progressTotal: 3,
                currentProjectId: 'project-1',
                currentProjectName: 'Operations',
                nextProjectId: 'project-2',
                nextProjectName: 'Marketing',
                trimHistoryBeforeMs: 1710000000000,
            },
        })
        expect(result.compactedContextMessage).toContain('Compacted thread state for this ongoing workflow:')
        expect(result.compactedContextMessage).toContain('Progress: 1 of 3')

        nowSpy.mockRestore()
    })

    test('rejects compact_thread_context when the tool is not permitted', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    allowedTools: [],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'compact_thread_context',
                {
                    summary: 'Finished Operations',
                    progressCompleted: 1,
                    progressTotal: 3,
                },
                'project-1',
                'assistant-1',
                'user-1',
                null,
                {
                    projectId: 'project-1',
                    assistantId: 'assistant-1',
                    objectType: 'topics',
                    objectId: 'chat-1',
                }
            )
        ).rejects.toThrow('Tool not permitted: compact_thread_context')
    })

    test('rejects invalid compact_thread_context payloads', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['compact_thread_context'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'compact_thread_context',
                {
                    progressCompleted: 2,
                    progressTotal: 3,
                },
                'project-1',
                'assistant-1',
                'user-1',
                null,
                {
                    projectId: 'project-1',
                    assistantId: 'assistant-1',
                    objectType: 'topics',
                    objectId: 'chat-1',
                }
            )
        ).rejects.toThrow('summary is required for compact_thread_context.')
    })

    test('injects hidden compacted state and excludes older comments in future context loads', async () => {
        mockDocGet.mockImplementation(function () {
            const path = this?.path || ''

            if (path === 'assistantThreadState/project-1_topics_chat-1_assistant-1') {
                return Promise.resolve({
                    exists: true,
                    data: () => ({
                        summary: 'Operations done. Marketing next.',
                        progressCompleted: 1,
                        progressTotal: 2,
                        currentProjectId: 'project-1',
                        currentProjectName: 'Operations',
                        nextProjectId: 'project-2',
                        nextProjectName: 'Marketing',
                        trimHistoryBeforeMs: 200,
                        updatedAt: { seconds: 1, nanoseconds: 0 },
                    }),
                })
            }

            if (path === 'projects/project-1') {
                return Promise.resolve({
                    exists: true,
                    data: () => ({
                        name: 'Operations',
                        description: 'Project context.',
                    }),
                })
            }

            return Promise.resolve({
                exists: false,
                data: () => ({}),
            })
        })

        mockCollectionGet.mockResolvedValue({
            docs: [
                {
                    id: 'recent-comment',
                    ref: { path: 'recent-comment-ref' },
                    data: () => ({
                        commentText: 'Recent assistant update',
                        fromAssistant: true,
                        created: 300,
                        lastChangeDate: 300,
                    }),
                },
                {
                    id: 'old-comment',
                    ref: { path: 'old-comment-ref' },
                    data: () => ({
                        commentText: 'Old assistant update',
                        fromAssistant: true,
                        created: 100,
                        lastChangeDate: 100,
                    }),
                },
            ],
        })

        const contextMessages = await getOptimizedContextMessages(
            'recent-comment',
            'project-1',
            'topics',
            'chat-1',
            'en',
            'Project Bot',
            'Be helpful.',
            [],
            null,
            null,
            'assistant-1'
        )

        const flattened = contextMessages
            .map(message => (typeof message[1] === 'string' ? message[1] : JSON.stringify(message[1])))
            .join('\n')

        expect(flattened).toContain('Compacted thread state for this ongoing workflow:')
        expect(flattened).toContain('Operations done. Marketing next.')
        expect(flattened).toContain('Recent assistant update')
        expect(flattened).not.toContain('Old assistant update')
    })

    test('includes the current note in assistant context for note chats', async () => {
        mockDocGet.mockImplementation(function () {
            const path = this?.path || ''

            if (path === 'chatComments/project-1/notes/note-1/comments/comment-1') {
                return Promise.resolve({
                    exists: true,
                    data: () => ({
                        commentText: 'Can you summarize this?',
                    }),
                })
            }

            if (path === 'user-1') {
                return Promise.resolve({
                    exists: true,
                    data: () => ({
                        projectIds: [],
                    }),
                })
            }

            return Promise.resolve({
                exists: false,
                data: () => ({}),
            })
        })

        mockCollectionGet.mockResolvedValue({
            docs: [
                {
                    id: 'comment-1',
                    ref: { path: 'comment-1-ref' },
                    data: () => ({
                        commentText: 'Can you summarize this?',
                        fromAssistant: false,
                        created: 300,
                        lastChangeDate: 300,
                    }),
                },
            ],
        })

        const contextMessages = await getOptimizedContextMessages(
            'comment-1',
            'project-1',
            'notes',
            'note-1',
            'en',
            'Project Bot',
            'Be helpful.',
            [],
            null,
            'user-1',
            'assistant-1'
        )

        const flattened = contextMessages
            .map(message => (typeof message[1] === 'string' ? message[1] : JSON.stringify(message[1])))
            .join('\n')

        expect(mockFetchNoteContentAsMarkdown).toHaveBeenCalledWith('project-1', 'note-1', 'user-1')
        expect(flattened).toContain('The current chat is attached to this note.')
        expect(flattened).toContain('do not call get_note to retrieve this same note')
        expect(flattened).toContain('## Note: Launch notes')
        expect(flattened).toContain('Ship checklist and unresolved rollout risks.')
    })

    test('grounds a VM-style task prompt with the current task name and description', async () => {
        mockDocGet.mockImplementation(function () {
            const path = this?.path || ''

            if (path === 'projects/project-1') {
                return Promise.resolve({
                    exists: true,
                    id: 'project-1',
                    data: () => ({ name: 'Alldone Product', description: 'Build Alldone.' }),
                })
            }

            if (path === 'items/project-1/tasks/task-1') {
                return Promise.resolve({
                    exists: true,
                    id: 'task-1',
                    data: () => ({
                        name: 'Fix task processor',
                        extendedName: 'Fix task processor',
                        description: 'Show the assistant avatar and preserve full context.',
                        humanReadableId: 'ALL-97',
                        taskMetadata: { source: 'predefined' },
                    }),
                })
            }

            if (path === 'chatObjects/project-1/chats/task-1') {
                return Promise.resolve({
                    exists: true,
                    data: () => ({ title: 'Fix task processor' }),
                })
            }

            return Promise.resolve({ exists: false, data: () => ({}) })
        })
        mockCollectionGet.mockResolvedValue({
            docs: [
                {
                    id: 'message-1',
                    ref: { path: 'message-1-ref' },
                    data: () => ({
                        commentText: 'Execute this task in a VM',
                        fromAssistant: false,
                        created: 300,
                        lastChangeDate: 300,
                    }),
                },
            ],
        })

        const contextMessages = await getOptimizedContextMessages(
            'message-1',
            'project-1',
            'tasks',
            'task-1',
            'en',
            'Project Bot',
            'Be helpful.',
            ['execute_task_in_vm'],
            null,
            null,
            'assistant-1'
        )
        const flattened = contextMessages.map(message => message[1]).join('\n')

        expect(flattened).toContain('When the user says "this task", they mean this exact task.')
        expect(flattened).toContain('Project: Alldone Product (ID: project-1)')
        expect(flattened).toContain('Task ID: task-1')
        expect(flattened).toContain('Task title: Fix task processor')
        expect(flattened).toContain('Task description: Show the assistant avatar and preserve full context.')
        expect(flattened).toContain('"humanReadableId":"ALL-97"')
        expect(flattened).toContain('Execute this task in a VM')

        const vmContext = await buildVmThreadContext({
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            options: {
                currentObject: true,
                userDescription: false,
                projectDescription: false,
                userMemory: false,
                assistantPersona: false,
                conversationHistory: false,
                chatAttachments: false,
                dateTime: false,
                language: false,
            },
        })

        expect(vmContext).toContain('Task title: Fix task processor')
        expect(vmContext).toContain('Task description: Show the assistant avatar and preserve full context.')
        expect(vmContext).toContain('Task ID: task-1')
    })

    test('rebuilds continuation conversation from compacted state after the tool runs', () => {
        const updatedConversation = buildConversationAfterToolExecution({
            currentConversation: [
                ['system', 'Base system instruction'],
                ['system', 'Compacted thread state for this ongoing workflow:\n- Summary:\nOld summary'],
                ['user', 'Update all project descriptions'],
                ['assistant', 'Detailed project 1 notes that should be dropped'],
            ],
            responseText: 'Detailed project 1 notes that should be dropped',
            toolName: 'compact_thread_context',
            toolArgs: {
                summary: 'Finished Operations. Marketing next.',
                progressCompleted: 1,
                progressTotal: 2,
            },
            toolCallId: 'tool-call-1',
            conversationSafeToolResult: {
                compactedContextMessage:
                    'Compacted thread state for this ongoing workflow:\n- Progress: 1 of 2 units completed.\n- Summary:\nFinished Operations. Marketing next.',
            },
            userContext: {
                message: 'Update all project descriptions',
            },
        })

        const contents = updatedConversation.map(message => message.content).join('\n')

        expect(contents).toContain('Base system instruction')
        expect(contents).toContain('Update all project descriptions')
        expect(contents).toContain('Finished Operations. Marketing next.')
        expect(contents).not.toContain('Detailed project 1 notes that should be dropped')
        expect(contents).not.toContain('Old summary')
        expect(updatedConversation[updatedConversation.length - 1]).toMatchObject({
            role: 'user',
            content: expect.stringContaining('Based on the tool results above'),
        })
        expect(updatedConversation[updatedConversation.length - 1].content).toContain(
            'Only treat the current tool call as failed'
        )
        expect(updatedConversation[updatedConversation.length - 1].content).toContain(
            'Do not infer current-run failure from nested historical text'
        )
    })

    test('returns every parallel tool result in one continuation turn', () => {
        const updatedConversation = buildConversationAfterToolExecutions({
            currentConversation: [['user', 'Create both follow-ups']],
            responseText: 'I will create both.',
            toolExecutions: [
                {
                    toolName: 'create_task',
                    toolArgs: { name: 'First task' },
                    toolCallId: 'call-1',
                    conversationSafeToolResult: { success: true, taskId: 'task-1' },
                },
                {
                    toolName: 'create_note',
                    toolArgs: { title: 'Follow-up note' },
                    toolCallId: 'call-2',
                    conversationSafeToolResult: { success: true, noteId: 'note-1' },
                },
            ],
        })

        const assistantMessage = updatedConversation.find(message => message.role === 'assistant')
        const toolMessages = updatedConversation.filter(message => message.role === 'tool')
        expect(assistantMessage.tool_calls.map(call => call.id)).toEqual(['call-1', 'call-2'])
        expect(toolMessages.map(message => message.tool_call_id)).toEqual(['call-1', 'call-2'])
        expect(updatedConversation[updatedConversation.length - 1]).toMatchObject({
            role: 'user',
            content: expect.stringContaining('Based on the tool results above'),
        })
    })

    test('reads compacted thread state as assistant context text', async () => {
        mockDocGet.mockImplementation(function () {
            const path = this?.path || ''
            if (path === 'assistantThreadState/project-1_topics_chat-1_assistant-1') {
                return Promise.resolve({
                    exists: true,
                    data: () => ({
                        summary: 'Operations done. Marketing next.',
                        progressCompleted: 1,
                        progressTotal: 2,
                        trimHistoryBeforeMs: 200,
                    }),
                })
            }

            return Promise.resolve({
                exists: false,
                data: () => ({}),
            })
        })

        await expect(
            getAssistantThreadStateContextMessage('project-1', 'topics', 'chat-1', 'assistant-1')
        ).resolves.toContain('Operations done. Marketing next.')
    })
})

describe('assistant user memory tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('records memory feed updates as the assistant actor', async () => {
        updateUserMemory.mockResolvedValue({
            success: true,
            skipped: false,
            noteId: 'note-1',
            projectId: 'project-1',
            message: 'User memory saved in project "project-1"',
        })

        const result = await executeToolNatively(
            'update_user_memory',
            {
                fact: 'Prefers short summaries',
                category: 'preference',
                reason: 'Helps tune assistant replies',
            },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(updateUserMemory).toHaveBeenCalledWith(
            expect.objectContaining({
                db: expect.any(Object),
                projectId: 'project-1',
                requestUserId: 'user-1',
                fact: 'Prefers short summaries',
                category: 'preference',
                reason: 'Helps tune assistant replies',
                feedUser: expect.objectContaining({ uid: 'assistant-1' }),
            })
        )
        expect(result).toMatchObject({
            success: true,
            skipped: false,
            noteId: 'note-1',
        })
    })
})

describe('assistant project description tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        ProjectService.mockClear()
    })

    test('injects current project description into base instructions for all chats', async () => {
        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                name: 'Operations',
                description: 'Current project description text.',
            }),
        })

        const messages = []
        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', [], null, {
            projectId: 'project-1',
            assistantId: 'assistant-1',
        })

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('Project description for this chat/thread:')
        expect(systemMessages).toContain('Current project description text.')
    })

    test('injects current project description and rewrite guidance into base instructions', async () => {
        mockDocGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({
                name: 'Operations',
                description: 'Current project description text.',
            }),
        })

        const messages = []
        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', ['update_project_description'], null, {
            projectId: 'project-1',
            assistantId: 'assistant-1',
        })

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('Project description for this chat/thread:')
        expect(systemMessages).toContain('Current project description text.')
        expect(systemMessages).toContain('Treat the current project description as the base text')
        expect(systemMessages).toContain('call get_user_projects first')
    })

    test('denies project description tool execution when not allowed', async () => {
        expect(await isToolAllowedForExecution([], 'update_project_description')).toBe(false)
        expect(await isToolAllowedForExecution(['update_project_description'], 'update_project_description')).toBe(true)
    })

    test('updates the current project description', async () => {
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest
                .fn()
                .mockResolvedValue([{ id: 'project-1', name: 'Operations', description: 'Old description' }]),
        }))
        updateProjectDescription.mockResolvedValue({
            success: true,
            updated: true,
            project: { id: 'project-1', name: 'Operations' },
            description: 'New description',
            previousDescription: 'Old description',
            message: 'Project description updated in project "Operations"',
        })
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_project_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        const result = await executeToolNatively(
            'update_project_description',
            { description: '  New description  ' },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(updateProjectDescription).toHaveBeenCalledWith(
            expect.objectContaining({
                db: expect.any(Object),
                projectId: 'project-1',
                userId: 'user-1',
                description: '  New description  ',
                feedUser: expect.objectContaining({ uid: 'assistant-1' }),
            })
        )
        expect(result).toMatchObject({
            success: true,
            updated: true,
            project: { id: 'project-1', name: 'Operations' },
            description: 'New description',
            previousDescription: 'Old description',
        })
    })

    test('updates an explicit projectId target', async () => {
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([
                { id: 'project-1', name: 'Operations', description: 'Old description' },
                { id: 'project-2', name: 'Marketing', description: 'Marketing description' },
            ]),
        }))
        updateProjectDescription.mockResolvedValue({
            success: true,
            updated: true,
            project: { id: 'project-2', name: 'Marketing' },
            description: 'Updated marketing description',
            previousDescription: 'Marketing description',
            message: 'Project description updated in project "Marketing"',
        })
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_project_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await executeToolNatively(
            'update_project_description',
            { description: 'Updated marketing description', projectId: 'project-2' },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(updateProjectDescription).toHaveBeenCalledWith(
            expect.objectContaining({
                db: expect.any(Object),
                projectId: 'project-2',
                userId: 'user-1',
                description: 'Updated marketing description',
                feedUser: expect.objectContaining({ uid: 'assistant-1' }),
            })
        )
    })

    test('updates an exact projectName target', async () => {
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([
                { id: 'project-1', name: 'Operations', description: 'Old description' },
                { id: 'project-2', name: 'Marketing', description: 'Marketing description' },
            ]),
        }))
        updateProjectDescription.mockResolvedValue({
            success: true,
            updated: true,
            project: { id: 'project-2', name: 'Marketing' },
            description: 'Updated marketing description',
            previousDescription: 'Marketing description',
            message: 'Project description updated in project "Marketing"',
        })
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_project_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await executeToolNatively(
            'update_project_description',
            { description: 'Updated marketing description', projectName: 'Marketing' },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(updateProjectDescription).toHaveBeenCalledWith(
            expect.objectContaining({
                db: expect.any(Object),
                projectId: 'project-2',
                userId: 'user-1',
                description: 'Updated marketing description',
                feedUser: expect.objectContaining({ uid: 'assistant-1' }),
            })
        )
    })

    test('rejects ambiguous projectName targets', async () => {
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([
                { id: 'project-1', name: 'Marketing Ops', description: '' },
                { id: 'project-2', name: 'Marketing Team', description: '' },
            ]),
        }))
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_project_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'update_project_description',
                { description: 'Updated marketing description', projectName: 'Marketing' },
                'project-1',
                'assistant-1',
                'user-1',
                null
            )
        ).rejects.toThrow('Multiple projects partially match "Marketing"')

        expect(updateProjectDescription).not.toHaveBeenCalled()
    })

    test('rejects missing projectName targets', async () => {
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([{ id: 'project-1', name: 'Operations', description: '' }]),
        }))
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_project_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'update_project_description',
                { description: 'Updated marketing description', projectName: 'Missing' },
                'project-1',
                'assistant-1',
                'user-1',
                null
            )
        ).rejects.toThrow('No project found matching "Missing".')

        expect(updateProjectDescription).not.toHaveBeenCalled()
    })

    test('returns no-op result when the helper reports no change', async () => {
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest
                .fn()
                .mockResolvedValue([{ id: 'project-1', name: 'Operations', description: 'Current description' }]),
        }))
        updateProjectDescription.mockResolvedValue({
            success: true,
            updated: false,
            project: { id: 'project-1', name: 'Operations' },
            description: 'Current description',
            previousDescription: 'Current description',
            message: 'Project description is already up to date in project "Operations"',
        })
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_project_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        const result = await executeToolNatively(
            'update_project_description',
            { description: 'Current description' },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(result.updated).toBe(false)
    })

    test('rejects project description updates without description', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_project_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively('update_project_description', {}, 'project-1', 'assistant-1', 'user-1', null)
        ).rejects.toThrow('description is required for update_project_description.')
    })

    test('rejects direct project description execution when the tool is not permitted', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    allowedTools: [],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'update_project_description',
                { description: 'New description' },
                'project-1',
                'assistant-1',
                'user-1',
                null
            )
        ).rejects.toThrow('Tool not permitted: update_project_description')
    })
})

describe('assistant user description tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        ProjectService.mockClear()
    })

    test('injects layered user description context and rewrite guidance into base instructions', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    displayName: 'Anna Alldone',
                    noteIdsByProject: {},
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    displayName: 'Anna Alldone',
                    extendedDescription: 'Global user profile text.',
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    name: 'Operations',
                    usersData: {
                        'user-1': {
                            extendedDescription: 'Current user update text.',
                        },
                    },
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    name: 'Operations',
                    description: 'Project-wide context.',
                }),
            })

        const messages = []
        await addBaseInstructions(messages, 'Project Bot', 'en', 'Be helpful.', ['update_user_description'], null, {
            projectId: 'project-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('Global user description from settings:')
        expect(systemMessages).toContain('Global user profile text.')
        expect(systemMessages).toContain('Project-specific user description for this project:')
        expect(systemMessages).toContain('Current user update text.')
        expect(systemMessages).toContain('takes precedence when they conflict')
        expect(systemMessages).toContain('treat the current user description as the base text')
        expect(systemMessages).toContain('call get_user_projects first')
    })

    test('denies user description tool execution when not allowed', async () => {
        expect(await isToolAllowedForExecution([], 'update_user_description')).toBe(false)
        expect(await isToolAllowedForExecution(['update_user_description'], 'update_user_description')).toBe(true)
    })

    test('updates the current user description globally by default', async () => {
        updateUserDescription.mockResolvedValue({
            success: true,
            updated: true,
            scope: 'global',
            user: { id: 'user-1', name: 'Anna Alldone' },
            description: 'New weekly update',
            previousDescription: 'Old weekly update',
            message: 'User description updated globally for "Anna Alldone"',
        })
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_user_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        const result = await executeToolNatively(
            'update_user_description',
            { description: '  New weekly update  ' },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(updateUserDescription).toHaveBeenCalledWith(
            expect.objectContaining({
                db: expect.any(Object),
                projectId: null,
                targetUserId: 'user-1',
                actorUserId: 'user-1',
                description: '  New weekly update  ',
                feedUser: expect.objectContaining({ uid: 'assistant-1' }),
            })
        )
        expect(result).toMatchObject({
            success: true,
            updated: true,
            scope: 'global',
            user: { id: 'user-1', name: 'Anna Alldone' },
            description: 'New weekly update',
            previousDescription: 'Old weekly update',
        })
    })

    test('updates the current user description in an explicit project target', async () => {
        ProjectService.mockImplementation(() => ({
            initialize: jest.fn().mockResolvedValue(undefined),
            getUserProjects: jest.fn().mockResolvedValue([
                { id: 'project-1', name: 'Operations', description: 'Project description' },
                { id: 'project-2', name: 'Marketing', description: 'Marketing description' },
            ]),
        }))
        updateUserDescription.mockResolvedValue({
            success: true,
            updated: true,
            user: { id: 'user-1', name: 'Anna Alldone' },
            project: { id: 'project-2', name: 'Marketing' },
            description: 'Marketing weekly update',
            previousDescription: 'Old marketing update',
            message: 'User description updated for "Anna Alldone" in project "Marketing"',
        })
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_user_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await executeToolNatively(
            'update_user_description',
            { description: 'Marketing weekly update', projectId: 'project-2' },
            'project-1',
            'assistant-1',
            'user-1',
            null
        )

        expect(updateUserDescription).toHaveBeenCalledWith(
            expect.objectContaining({
                db: expect.any(Object),
                projectId: 'project-2',
                targetUserId: 'user-1',
                actorUserId: 'user-1',
                description: 'Marketing weekly update',
                feedUser: expect.objectContaining({ uid: 'assistant-1' }),
            })
        )
    })

    test('rejects user description updates without description', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_user_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively('update_user_description', {}, 'project-1', 'assistant-1', 'user-1', null)
        ).rejects.toThrow('description is required for update_user_description.')
    })

    test('rejects user description updates without a requesting user', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    uid: 'assistant-1',
                    allowedTools: ['update_user_description'],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'update_user_description',
                { description: 'New weekly update' },
                'project-1',
                'assistant-1',
                null,
                null
            )
        ).rejects.toThrow('User description update requires a valid requesting user.')
    })

    test('rejects direct user description execution when the tool is not permitted', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    allowedTools: [],
                }),
            })
            .mockResolvedValueOnce({ exists: false, data: () => ({}) })

        await expect(
            executeToolNatively(
                'update_user_description',
                { description: 'New weekly update' },
                'project-1',
                'assistant-1',
                'user-1',
                null
            )
        ).rejects.toThrow('Tool not permitted: update_user_description')
    })
})

describe('assistant shared user context', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('injects global user description, project-specific user description, and project description into general chats', async () => {
        mockDocGet
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    displayName: 'Anna Alldone',
                    noteIdsByProject: {},
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    displayName: 'Anna Alldone',
                    extendedDescription: 'Anna wants concise, strategic weekly summaries.',
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    name: 'Operations',
                    usersData: {
                        'user-1': {
                            extendedDescription: 'In Operations, Anna is acting as sponsor and final approver.',
                        },
                    },
                }),
            })
            .mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    name: 'Operations',
                    description: 'Operations is focused on launch readiness and weekly execution.',
                }),
            })

        const messages = []
        await addBaseInstructions(messages, 'General Bot', 'en', 'Be helpful.', ['create_task'], null, {
            projectId: 'project-1',
            assistantId: 'assistant-1',
            requestUserId: 'user-1',
        })

        const systemMessages = messages
            .filter(message => message[0] === 'system')
            .map(message => message[1])
            .join('\n')

        expect(systemMessages).toContain('Global user description from settings:')
        expect(systemMessages).toContain('Anna wants concise, strategic weekly summaries.')
        expect(systemMessages).toContain('Project-specific user description for this project:')
        expect(systemMessages).toContain('In Operations, Anna is acting as sponsor and final approver.')
        expect(systemMessages).toContain('Project description for this chat/thread:')
        expect(systemMessages).toContain('Operations is focused on launch readiness and weekly execution.')
        expect(systemMessages).toContain('include create_task.projectRoutingReason')
    })
})
