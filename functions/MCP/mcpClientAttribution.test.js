'use strict'

// An MCP client acts in the user's name, and what it writes says which client it was
// ("Karsten Wysk (via Codex)", shared/mcpActor.js). The label comes from the name the client sends
// with `initialize`, which the server remembers on the access token the client authenticates with.

const mockDocs = new Map()
const mockUpdates = []

jest.mock('firebase-admin', () => ({
    auth: jest.fn(() => ({ verifyIdToken: jest.fn().mockRejectedValue(new Error('not a Firebase ID token')) })),
    firestore: jest.fn(() => ({
        collection: jest.fn(collection => ({
            doc: jest.fn(id => {
                const path = `${collection}/${id}`
                return {
                    get: jest.fn(async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) })),
                    update: jest.fn(async data => {
                        mockUpdates.push({ path, data })
                        mockDocs.set(path, { ...mockDocs.get(path), ...data })
                    }),
                }
            }),
        })),
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

jest.mock('../Assistant/assistantHelper', () => ({ executeToolNatively: jest.fn() }))

const ACCESS_TOKEN = 'mcp_access_1'
const REFRESH_TOKEN = 'mcp_refresh_1'

const storeToken = (fields = {}) => {
    mockDocs.set(`oauthTokens/${ACCESS_TOKEN}`, {
        userId: 'user-1',
        refreshToken: REFRESH_TOKEN,
        // Far in the future: the web jest setup pins Date.now, while the server compares with new Date().
        expiresAt: { toDate: () => new Date('2100-01-01T00:00:00Z') },
        ...fields,
    })
    mockDocs.set(`oauthRefreshTokens/${REFRESH_TOKEN}`, { userId: 'user-1' })
}

const buildRequest = () => ({ headers: { authorization: `Bearer ${ACCESS_TOKEN}`, 'user-agent': 'test' } })

describe('MCP client attribution', () => {
    let server
    beforeEach(() => {
        mockDocs.clear()
        mockUpdates.length = 0
        mockDocs.set('users/user-1', { timezone: 2, language: 'de' })
        const { AlldoneSimpleMCPServer } = require('./mcpServerSimple')
        server = new AlldoneSimpleMCPServer()
    })

    test('a tool call carries the label of the client behind its token', async () => {
        storeToken({ mcpClientName: 'codex-mcp-client' })
        const request = buildRequest()

        const userId = await server.getAuthenticatedUserForClient(request)
        const context = await server.buildDelegatedToolRuntimeContext(userId, request)

        expect(userId).toBe('user-1')
        expect(context).toEqual(expect.objectContaining({ sourceChannel: 'mcp', mcpClient: 'Codex' }))
    })

    test('a token that never reported a client is attributed to MCP without a client', async () => {
        storeToken()
        const request = buildRequest()

        const userId = await server.getAuthenticatedUserForClient(request)
        const context = await server.buildDelegatedToolRuntimeContext(userId, request)

        expect(context.mcpClient).toBeNull()
        expect(context.sourceChannel).toBe('mcp')
    })

    test('initialize remembers the client on the access token and its refresh token, once', async () => {
        storeToken()
        server.checkRateLimits = jest.fn().mockResolvedValue({ allowed: true })
        const initialize = request =>
            server.handleSingleJsonRpc(
                {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: { protocolVersion: '2025-03-26', clientInfo: { name: 'Anthropic/ClaudeAI' } },
                },
                request
            )

        await initialize(buildRequest())
        expect(mockUpdates).toEqual([
            { path: `oauthTokens/${ACCESS_TOKEN}`, data: { mcpClientName: 'Anthropic/ClaudeAI' } },
            { path: `oauthRefreshTokens/${REFRESH_TOKEN}`, data: { mcpClientName: 'Anthropic/ClaudeAI' } },
        ])

        // The next session of the same client finds the name already stored and writes nothing.
        await initialize(buildRequest())
        expect(mockUpdates).toHaveLength(2)

        const request = buildRequest()
        await server.getAuthenticatedUserForClient(request)
        expect(server.getMcpClientLabel(request)).toBe('Claude')
    })
})
