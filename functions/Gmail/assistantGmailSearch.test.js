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
    getAuthorizedOAuth2Client: jest.fn(async () => ({
        setCredentials: mockSetCredentials,
        on: jest.fn(),
    })),
}))

const { buildConnectionId } = require('../Integrations/providerConnections')
const { getConnectedGmailAccounts, getGmailAttachmentForAssistantRequest } = require('./assistantGmailSearch')

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
        expect(result.projectId).toBe(buildConnectionId('email', 'google', 'person@example.com'))
        expect(result.gmailEmail).toBe('person@example.com')
    })

    test('uses the global default Gmail account even when legacy project flags disagree', async () => {
        const connectionId = buildConnectionId('email', 'google', 'default@example.com')
        mockUserGet.mockResolvedValue({
            exists: true,
            data: () => ({
                emailConnections: {
                    [connectionId]: {
                        provider: 'google',
                        emailAddress: 'default@example.com',
                        defaultProjectId: 'integration-home-project',
                        isDefaultAccount: true,
                    },
                },
                apisConnected: {
                    'integration-home-project': {
                        gmail: true,
                        gmailEmail: 'default@example.com',
                        gmailDefault: false,
                    },
                },
            }),
        })

        await expect(getConnectedGmailAccounts('user-1')).resolves.toEqual([
            {
                provider: 'google',
                projectId: connectionId,
                connectionProjectId: 'integration-home-project',
                gmailEmail: 'default@example.com',
                emailAddress: 'default@example.com',
                gmailDefault: true,
                emailDefault: true,
            },
        ])
    })
})
