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
const { buildConnectionId } = require('../../Integrations/providerConnections')
const { getConnectedMicrosoftEmailAccounts } = require('./microsoftEmailProvider')

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
