'use strict'

const mockUserDocGet = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        collection: jest.fn(path => {
            if (path === 'users') {
                return {
                    doc: jest.fn(() => ({
                        get: mockUserDocGet,
                    })),
                }
            }

            return {
                doc: jest.fn(() => ({
                    get: jest.fn(),
                    set: jest.fn(),
                })),
            }
        }),
    })),
    app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })),
}))

jest.mock('./auth/cloudOAuth.js', () => ({
    CloudOAuthHandler: jest.fn().mockImplementation(() => ({})),
    CloudSessionManager: jest.fn().mockImplementation(() => ({})),
    UserSessionManager: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('./config/environments.js', () => ({
    getEnvironmentConfig: jest.fn(() => ({ mcpBaseUrl: 'https://my.alldone.app' })),
}))

jest.mock(
    'firebase-functions/params',
    () => ({
        defineString: jest.fn(() => ({ value: jest.fn(() => '') })),
    }),
    { virtual: true }
)

const mockGetContacts = jest.fn()

jest.mock('../shared/ContactRetrievalService', () => ({
    ContactRetrievalService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getContacts: mockGetContacts,
    })),
}))

describe('AlldoneSimpleMCPServer get_contacts tool', () => {
    let originalSetTimeout
    let AlldoneSimpleMCPServer

    beforeAll(() => {
        originalSetTimeout = global.setTimeout
        global.setTimeout = jest.fn(() => 0)
        ;({ AlldoneSimpleMCPServer } = require('./mcpServerSimple'))
    })

    afterAll(() => {
        global.setTimeout = originalSetTimeout
    })

    beforeEach(() => {
        jest.clearAllMocks()
        mockUserDocGet.mockResolvedValue({
            exists: true,
            data: () => ({ timezone: 'UTC+02:00' }),
        })
        mockGetContacts.mockResolvedValue({
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

    test('includes get_contacts in tools/list', async () => {
        const server = new AlldoneSimpleMCPServer()

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            },
            {}
        )

        const tool = response.result.tools.find(entry => entry.name === 'get_contacts')
        expect(tool).toBeDefined()
        expect(tool.inputSchema.properties.projectId.type).toBe('string')
        expect(tool.inputSchema.properties.projectName.type).toBe('string')
        expect(tool.inputSchema.properties.date.type).toBe('string')
        expect(tool.inputSchema.properties.limit.type).toBe('number')
    })

    test('includes safe patch fields for update_note in tools/list', async () => {
        const server = new AlldoneSimpleMCPServer()

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/list',
            },
            {}
        )

        const tool = response.result.tools.find(entry => entry.name === 'update_note')
        expect(tool).toBeDefined()
        expect(tool.inputSchema.required).toEqual([])
        expect(tool.inputSchema.properties.mode.enum).toEqual(['prepend', 'patch'])
        expect(tool.inputSchema.properties.edits.type).toBe('array')
        expect(tool.inputSchema.properties.edits.items.properties.type.enum).toEqual([
            'replace_text',
            'replace_section',
            'insert_before',
            'insert_after',
        ])
    })

    test('routes tools/call for get_contacts and returns the response shape', async () => {
        const server = new AlldoneSimpleMCPServer()
        server.getAuthenticatedUserForClient = jest.fn().mockResolvedValue('user-1')
        server.checkRateLimits = jest.fn().mockResolvedValue({ allowed: true })

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                    name: 'get_contacts',
                    arguments: {
                        projectName: 'Marketing',
                        date: 'last week',
                        limit: 25,
                    },
                },
            },
            {}
        )

        expect(mockGetContacts).toHaveBeenCalledWith({
            userId: 'user-1',
            projectId: '',
            projectName: 'Marketing',
            date: 'last week',
            limit: 25,
            timezoneOffset: 120,
        })

        expect(JSON.parse(response.result.content[0].text)).toEqual({
            success: true,
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
