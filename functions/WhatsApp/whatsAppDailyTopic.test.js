const mockGet = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        collection: jest.fn(() => ({
            orderBy: jest.fn(() => ({
                limit: jest.fn(() => ({
                    get: mockGet,
                })),
            })),
        })),
    })),
}))

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 'all',
    STAYWARD_COMMENT: 'comment',
}))

const { getConversationHistory } = require('./whatsAppDailyTopic')

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

        await expect(getConversationHistory('project-1', 'chat-1', 10)).resolves.toEqual([
            [
                'user',
                [
                    {
                        type: 'text',
                        text: 'Please review\n\n[FILE: invoice.pdf, type=application/pdf]\nInvoice total is 120 EUR.',
                    },
                    {
                        type: 'image_url',
                        image_url: { url: 'https://cdn.example.com/image.png' },
                    },
                ],
            ],
        ])
    })
})
