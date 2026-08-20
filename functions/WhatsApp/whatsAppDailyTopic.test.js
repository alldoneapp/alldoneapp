const mockGet = jest.fn()
const mockDocSet = jest.fn(async () => {})
const mockDocUpdate = jest.fn(async () => {})
const mockDocPaths = []

global.fetch = jest.fn()
global.AbortSignal = { timeout: jest.fn(() => undefined) }

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        collection: jest.fn(() => ({
            orderBy: jest.fn(() => ({
                limit: jest.fn(() => ({
                    get: mockGet,
                })),
            })),
        })),
        doc: jest.fn(path => {
            mockDocPaths.push(path)
            return {
                path,
                set: (...args) => mockDocSet(path, ...args),
                update: (...args) => mockDocUpdate(path, ...args),
            }
        }),
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

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 'all',
    STAYWARD_COMMENT: 'comment',
}))

jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { increment: value => ({ __increment: value }) },
    Timestamp: { now: () => ({ __timestamp: true }) },
}))

const { getConversationHistory, storeAssistantMessageInTopic } = require('./whatsAppDailyTopic')

// The live WhatsApp reply path. Its comment id is random and its writes are best-effort
// on purpose — the inbound queue's own dedupe is what keeps it single-shot. Pinned here
// because AT-2387 factored the comment/chat payloads out of it to share them with the
// idempotent mirror writer; the shape it writes must not have moved.
describe('storeAssistantMessageInTopic', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockDocPaths.length = 0
    })

    test('writes the comment, refreshes the chat preview and moves the AssistantLine pointer', async () => {
        const commentId = await storeAssistantMessageInTopic('project-1', 'chat-1', 'assistant-1', 'Hi there', 'user-1')

        expect(mockDocSet).toHaveBeenCalledWith(
            `chatComments/project-1/topics/chat-1/comments/${commentId}`,
            expect.objectContaining({
                commentText: 'Hi there',
                creatorId: 'assistant-1',
                fromAssistant: true,
                source: 'whatsapp',
            })
        )
        expect(mockDocUpdate).toHaveBeenCalledWith(
            'chatObjects/project-1/chats/chat-1',
            expect.objectContaining({
                lastEditorId: 'assistant-1',
                'commentsData.lastComment': 'Hi there',
                'commentsData.lastCommentType': 'comment',
                'commentsData.amount': { __increment: 1 },
            })
        )
        expect(mockDocUpdate).toHaveBeenCalledWith(
            'users/user-1',
            expect.objectContaining({
                'lastAssistantCommentData.project-1': expect.objectContaining({
                    objectType: 'topics',
                    objectId: 'chat-1',
                    creatorId: 'assistant-1',
                }),
            })
        )
    })

    test('leaves the AssistantLine pointer alone when there is no user', async () => {
        await storeAssistantMessageInTopic('project-1', 'chat-1', 'assistant-1', 'Hi there', '')

        expect(mockDocPaths).not.toContain('users/')
        expect(mockDocUpdate).toHaveBeenCalledTimes(1)
    })
})

describe('WhatsApp daily topic media history', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('builds multimodal history from mediaContext and processedMedia fallback', async () => {
        mockGet.mockResolvedValue({
            docs: [
                {
                    id: 'message-1',
                    ref: { set: jest.fn(async () => {}) },
                    data: () => ({
                        fromAssistant: false,
                        created: Date.UTC(2026, 2, 31, 8, 15, 0),
                        commentText:
                            'Please review O2TI5plHBf1QfdYhttps://cdn.example.com/image.pngO2TI5plHBf1QfdYhttps://cdn.example.com/image-small.pngO2TI5plHBf1QfdYreceipt.pngO2TI5plHBf1QfdYfalse',
                        processedMedia: [
                            {
                                kind: 'file',
                                fileName: 'invoice.pdf',
                                contentType: 'application/pdf',
                                storageUrl: 'https://cdn.example.com/file.pdf',
                                extractedText: 'Invoice total is 120 EUR.',
                                extractionStatus: 'extracted',
                            },
                        ],
                    }),
                },
            ],
        })

        await expect(getConversationHistory('project-1', 'chat-1', 10, 60)).resolves.toEqual([
            [
                'user',
                [
                    {
                        type: 'text',
                        text:
                            '[Sent at 2026-03-31 09:15:00 UTC+1]\n' +
                            'Please review\n\n[FILE: invoice.pdf, type=application/pdf]\nInvoice total is 120 EUR.',
                    },
                    {
                        type: 'image_url',
                        image_url: { url: 'https://cdn.example.com/image.png' },
                    },
                ],
            ],
        ])
    })

    test('does not duplicate an image represented by mediaContext and its inline token', async () => {
        const storageUrl = 'https://cdn.example.com/whatsapp-upload.jpg'
        mockGet.mockResolvedValue({
            docs: [
                {
                    id: 'message-1',
                    ref: { set: jest.fn(async () => {}) },
                    data: () => ({
                        fromAssistant: false,
                        created: Date.UTC(2026, 6, 21, 17, 8, 9),
                        commentText:
                            `O2TI5plHBf1QfdY${storageUrl}` +
                            `O2TI5plHBf1QfdY${storageUrl}` +
                            'O2TI5plHBf1QfdYFile.jpgO2TI5plHBf1QfdY0',
                        imageCount: 1,
                        mediaContext: [
                            {
                                kind: 'image',
                                fileName: 'File.jpg',
                                mimeType: 'image/jpeg',
                                storageUrl,
                                previewUrl: storageUrl,
                            },
                        ],
                    }),
                },
            ],
        })

        const history = await getConversationHistory('project-1', 'chat-1', 10, 0)

        expect(history).toHaveLength(1)
        expect(history[0][0]).toBe('user')
        expect(history[0][1].filter(part => part.type === 'image_url')).toEqual([
            {
                type: 'image_url',
                image_url: { url: storageUrl },
            },
        ])
    })

    test('leaves assistant turns untouched so the model cannot mimic [Sent at ...]', async () => {
        mockGet.mockResolvedValue({
            docs: [
                {
                    id: 'assistant-turn',
                    data: () => ({
                        fromAssistant: true,
                        created: Date.UTC(2026, 2, 31, 8, 15, 0),
                        commentText: 'Here is my previous answer.',
                    }),
                },
            ],
        })

        const history = await getConversationHistory('project-1', 'chat-1', 10, 60)

        expect(history).toEqual([['assistant', 'Here is my previous answer.']])
    })
})
