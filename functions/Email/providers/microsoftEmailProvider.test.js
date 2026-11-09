'use strict'

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

jest.mock('../../MicrosoftGraph/graphClient', () => ({
    buildQuery: jest.fn(),
    encodePath: jest.fn(value => value),
    getMicrosoftGraphClient: jest.fn(),
}))

const admin = require('firebase-admin')
const { getMicrosoftGraphClient } = require('../../MicrosoftGraph/graphClient')
const { buildConnectionId } = require('../../Integrations/providerConnections')
const {
    getConnectedMicrosoftEmailAccounts,
    updateMicrosoftEmailForAssistantRequest,
} = require('./microsoftEmailProvider')

describe('microsoftEmailProvider account resolution', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('uses the account-level Microsoft Email default across projects', async () => {
        const connectionId = buildConnectionId('email', 'microsoft', 'owner@example.com')
        admin.firestore.mockReturnValue({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({
                            emailConnections: {
                                [connectionId]: {
                                    provider: 'microsoft',
                                    emailAddress: 'owner@example.com',
                                    defaultProjectId: 'integration-home-project',
                                    isDefaultAccount: true,
                                },
                            },
                            apisConnected: {
                                'integration-home-project': {
                                    email: true,
                                    emailProvider: 'microsoft',
                                    emailAddress: 'owner@example.com',
                                    emailDefault: false,
                                },
                            },
                        }),
                    }),
                })),
            })),
        })

        await expect(getConnectedMicrosoftEmailAccounts('user-1')).resolves.toEqual([
            {
                projectId: connectionId,
                connectionProjectId: 'integration-home-project',
                provider: 'microsoft',
                gmailEmail: 'owner@example.com',
                emailAddress: 'owner@example.com',
                gmailDefault: true,
                emailDefault: true,
            },
        ])
    })
})

describe('updateMicrosoftEmailForAssistantRequest', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('reports the subject and only what really changed, in the Gmail tool vocabulary', async () => {
        const connectionId = buildConnectionId('email', 'microsoft', 'owner@example.com')
        admin.firestore.mockReturnValue({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({
                            emailConnections: {
                                [connectionId]: {
                                    provider: 'microsoft',
                                    emailAddress: 'owner@example.com',
                                    defaultProjectId: 'project-1',
                                    isDefaultAccount: true,
                                },
                            },
                        }),
                    }),
                })),
            })),
        })
        const request = jest.fn((path, options) => {
            if (options?.method === 'PATCH') return Promise.resolve({ id: 'message-1', subject: 'Invoice 42' })
            return Promise.resolve({
                id: 'message-1',
                subject: 'Invoice 42',
                categories: ['Clients'],
                isRead: false,
                importance: 'high',
            })
        })
        getMicrosoftGraphClient.mockResolvedValue({ request })

        const result = await updateMicrosoftEmailForAssistantRequest({
            userId: 'user-1',
            messageId: 'message-1',
            addLabelIds: ['Finance', 'Clients'],
            markUnread: false,
            important: true,
        })

        expect(result).toMatchObject({
            success: true,
            projectId: connectionId,
            subject: 'Invoice 42',
            // Clients and IMPORTANT were already set; marking read is a real change.
            changedLabels: { added: ['Finance'], removed: ['UNREAD'] },
        })
    })
})
