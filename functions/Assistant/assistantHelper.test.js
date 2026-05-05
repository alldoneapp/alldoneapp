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

jest.mock('../shared/ProjectService', () => ({
    ProjectService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getUserProjects: jest.fn().mockResolvedValue([]),
    })),
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
jest.mock('./userMemoryHelper', () => {
    const actual = jest.requireActual('./userMemoryHelper')
    return {
        ...actual,
        updateUserMemory: jest.fn(),
    }
})
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

jest.mock('firebase-admin', () => ({
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

jest.mock('openai', () => jest.fn())
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
    filterTasksByRecentHours,
    mapAssistantTaskForToolResponse,
    mapAssistantGoalForToolResponse,
    getToolResultFollowUpPrompt,
    addBaseInstructions,
    executeToolNatively,
    isToolAllowedForExecution,
    getHeartbeatSettingsContextMessage,
    getAssistantThreadStateContextMessage,
    getOptimizedContextMessages,
    buildConversationAfterToolExecution,
    getSilentModeFinalResponseText,
    storeBotAnswerStream,
    calculateGoldCostFromTokens,
} = require('./assistantHelper')

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
            mapAssistantTaskForToolResponse({
                documentId: 'task-1',
                name: 'Follow up',
                done: true,
                completed: 1774970400000,
                projectName: 'Alldone',
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
            })
        ).toEqual({
            id: 'task-1',
            name: 'Follow up',
            completed: true,
            completedAt: 1774970400000,
            projectName: 'Alldone',
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
        })

        expect(getUserProjects).toHaveBeenCalledWith('u-1', {
            includeArchived: false,
            includeCommunity: false,
        })
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
                timezoneOffset: 120,
            }),
            ['project-1'],
            {
                'project-1': { id: 'project-1', name: 'Privat' },
            }
        )
        expect(result).toMatchObject({
            count: 1,
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
    })
})
