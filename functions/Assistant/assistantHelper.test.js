const {
    normalizeCreateTaskImageUrls,
    buildCreateTaskImageTokens,
    mergeTaskDescriptionWithImages,
    extractImageUrlsFromMessageContent,
    injectCurrentMessageImagesIntoCreateTaskArgs,
} = require('./createTaskImageHelper')
const {
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
jest.mock('../shared/projectDescriptionUpdateHelper', () => ({
    updateProjectDescription: jest.fn(),
}))
jest.mock('../shared/userDescriptionUpdateHelper', () => ({
    updateUserDescription: jest.fn(),
}))
jest.mock('../GAnalytics/GAnalytics', () => ({
    logEvent: jest.fn(),
}))

const mockDocGet = jest.fn()
const mockDocSet = jest.fn(async () => {})
const mockDocUpdate = jest.fn(async () => {})
const mockCollectionGet = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: jest.fn(() => ({
            get: mockDocGet,
            set: mockDocSet,
            update: mockDocUpdate,
        })),
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
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
    })),
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
const { ChatRetrievalService } = require('../shared/ChatRetrievalService')
const { updateProjectDescription } = require('../shared/projectDescriptionUpdateHelper')
const { updateUserDescription } = require('../shared/userDescriptionUpdateHelper')
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
    addBaseInstructions,
    executeToolNatively,
    isToolAllowedForExecution,
    getHeartbeatSettingsContextMessage,
} = require('./assistantHelper')

describe('assistant attachment handoff helpers', () => {
    test('normalizes hour-based user timezone values into minutes', () => {
        expect(resolveUserTimezoneOffset({ timezone: 1 })).toBe(60)
        expect(resolveUserTimezoneOffset({ timezoneOffset: 'UTC+02:30' })).toBe(150)
    })

    test('formats context message timestamps in the user timezone', () => {
        expect(formatContextMessageTimestamp(Date.UTC(2026, 2, 31, 8, 15, 0), 120)).toBe('2026-03-31 10:15:00 UTC+2')
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
                },
            ],
            commentsData: {
                amount: 1,
                lastComment: 'Need final approval',
            },
            isFocus: true,
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

describe('assistant heartbeat settings tool', () => {
    beforeEach(() => {
        jest.clearAllMocks()
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

        expect(mockDocUpdate).toHaveBeenCalledWith({
            heartbeatIntervalMs: 15 * 60 * 1000,
            heartbeatChancePercent: 100,
            heartbeatAwakeStart: (9 * 60 + 15) * 60 * 1000,
            heartbeatAwakeEnd: (18 * 60 + 45) * 60 * 1000,
            heartbeatSendWhatsApp: false,
            heartbeatPrompt: 'New prompt for heartbeat',
        })
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

        expect(updateProjectDescription).toHaveBeenCalledWith({
            db: expect.any(Object),
            projectId: 'project-1',
            userId: 'user-1',
            description: '  New description  ',
        })
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

        expect(updateProjectDescription).toHaveBeenCalledWith({
            db: expect.any(Object),
            projectId: 'project-2',
            userId: 'user-1',
            description: 'Updated marketing description',
        })
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

        expect(updateProjectDescription).toHaveBeenCalledWith({
            db: expect.any(Object),
            projectId: 'project-2',
            userId: 'user-1',
            description: 'Updated marketing description',
        })
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

        expect(updateUserDescription).toHaveBeenCalledWith({
            db: expect.any(Object),
            projectId: null,
            targetUserId: 'user-1',
            actorUserId: 'user-1',
            description: '  New weekly update  ',
        })
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

        expect(updateUserDescription).toHaveBeenCalledWith({
            db: expect.any(Object),
            projectId: 'project-2',
            targetUserId: 'user-1',
            actorUserId: 'user-1',
            description: 'Marketing weekly update',
        })
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
