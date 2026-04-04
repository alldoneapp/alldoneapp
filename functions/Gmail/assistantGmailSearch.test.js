const mockUserGet = jest.fn()
const mockMessagesGet = jest.fn()
const mockSetCredentials = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({
                get: mockUserGet,
            })),
        })),
    })),
}))

jest.mock('googleapis', () => ({
    google: {
        gmail: jest.fn(() => ({
            users: {
                messages: {
                    get: mockMessagesGet,
                    attachments: {
                        get: jest.fn(),
                    },
                },
            },
        })),
    },
}))

jest.mock('../GoogleOAuth/googleOAuthHandler', () => ({
    getAccessToken: jest.fn(async () => 'access-token'),
    getOAuth2Client: jest.fn(() => ({
        setCredentials: mockSetCredentials,
    })),
}))

const { getGmailAttachmentForAssistantRequest } = require('./assistantGmailSearch')

describe('assistantGmailSearch attachment retrieval', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('allows Gmail attachments larger than 5 MB up to the new 10 MB limit', async () => {
        const buffer = Buffer.alloc(6 * 1024 * 1024, 1)
        const base64Url = buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

        mockUserGet.mockResolvedValue({
            exists: true,
            data: () => ({
                defaultProjectId: 'project-1',
                projectIds: ['project-1'],
                apisConnected: {
                    'project-1': {
                        gmail: true,
                        gmailEmail: 'person@example.com',
                    },
                },
            }),
        })
        mockMessagesGet.mockResolvedValue({
            data: {
                id: 'message-1',
                payload: {
                    headers: [],
                    parts: [
                        {
                            filename: 'invoice.pdf',
                            mimeType: 'application/pdf',
                            body: {
                                data: base64Url,
                                size: buffer.length,
                            },
                        },
                    ],
                },
            },
        })

        const result = await getGmailAttachmentForAssistantRequest({
            userId: 'user-1',
            messageId: 'message-1',
            fileName: 'invoice.pdf',
        })

        expect(result.success).toBe(true)
        expect(result.fileName).toBe('invoice.pdf')
        expect(result.fileMimeType).toBe('application/pdf')
        expect(result.fileSizeBytes).toBe(buffer.length)
        expect(result.fileBase64).toBe(buffer.toString('base64'))
        expect(result.projectId).toBe('project-1')
        expect(result.gmailEmail).toBe('person@example.com')
    })
})
