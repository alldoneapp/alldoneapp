'use strict'

// AT-2871: the signed-in web app exposes the MCP tools to browser agents through WebMCP
// (`document.modelContext`) and a `window.alldone` JavaScript API. Both call this server with the
// page's Firebase ID token and declare themselves with the `x-alldone-mcp-client` header.

const mockDocs = new Map()

jest.mock('firebase-admin', () => ({
    auth: jest.fn(() => ({
        verifyIdToken: jest.fn(async token => {
            if (typeof token === 'string' && token.startsWith('eyJ')) return { uid: 'user-1' }
            throw new Error('not a Firebase ID token')
        }),
    })),
    firestore: jest.fn(() => ({
        collection: jest.fn(collection => ({
            doc: jest.fn(id => {
                const path = `${collection}/${id}`
                return {
                    get: jest.fn(async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) })),
                    update: jest.fn(async data => mockDocs.set(path, { ...mockDocs.get(path), ...data })),
                    set: jest.fn(),
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

const mockExecuteToolNatively = jest.fn()
jest.mock('../Assistant/assistantHelper', () => ({ executeToolNatively: mockExecuteToolNatively }))

const JWT_HEADER = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyIsInR5cCI6IkpXVCJ9'
const idToken = subject => `${JWT_HEADER}.${Buffer.from(subject).toString('base64url')}.signature-${subject}`
const OAUTH_TOKEN = 'mcp_access_1'

const browserRequest = (extra = {}) => ({
    headers: {
        authorization: `Bearer ${idToken('user-1')}`,
        'x-alldone-mcp-client': 'alldone-browser-agent',
        ...extra,
    },
})

describe('MCP browser-agent bridge (AT-2871)', () => {
    let server
    let originalSetTimeout

    beforeAll(() => {
        originalSetTimeout = global.setTimeout
        global.setTimeout = jest.fn(() => 0)
    })

    afterAll(() => {
        global.setTimeout = originalSetTimeout
    })

    beforeEach(() => {
        mockDocs.clear()
        mockExecuteToolNatively.mockReset()
        mockDocs.set('users/user-1', { timezone: 2, language: 'de' })
        mockDocs.set(`oauthTokens/${OAUTH_TOKEN}`, {
            userId: 'user-1',
            mcpClientName: 'codex-mcp-client',
            expiresAt: { toDate: () => new Date('2100-01-01T00:00:00Z') },
        })
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
        const { AlldoneSimpleMCPServer } = require('./mcpServerSimple')
        server = new AlldoneSimpleMCPServer()
        server.checkRateLimits = jest.fn().mockResolvedValue({ allowed: true })
        server.getUserProjectList = jest.fn().mockResolvedValue([{ id: 'p1', name: 'Project 1' }])
    })

    afterEach(() => jest.restoreAllMocks())

    test('a signed-in page that declares the bridge is labelled "Browser agent"', async () => {
        const request = browserRequest()
        const userId = await server.getAuthenticatedUserForClient(request)
        const context = await server.buildDelegatedToolRuntimeContext(userId, request)

        expect(userId).toBe('user-1')
        expect(server.isBrowserAgentRequest(request)).toBe(true)
        expect(context).toMatchObject({ sourceChannel: 'mcp', mcpClient: 'Browser agent' })
    })

    test('an OAuth token keeps the client it reported, whatever header it sends', async () => {
        const request = {
            headers: { authorization: `Bearer ${OAUTH_TOKEN}`, 'x-alldone-mcp-client': 'alldone-browser-agent' },
        }
        const userId = await server.getAuthenticatedUserForClient(request)
        const context = await server.buildDelegatedToolRuntimeContext(userId, request)

        expect(server.isBrowserAgentRequest(request)).toBe(false)
        expect(context.mcpClient).toBe('Codex')
    })

    test('a Firebase ID token without the header is plain MCP, not the bridge', async () => {
        const request = { headers: { authorization: `Bearer ${idToken('user-1')}` } }
        const userId = await server.getAuthenticatedUserForClient(request)
        const context = await server.buildDelegatedToolRuntimeContext(userId, request)

        expect(server.isBrowserAgentRequest(request)).toBe(false)
        expect(context.mcpClient).toBeNull()
    })

    test('an unknown self-declared name is never rendered verbatim', async () => {
        const request = browserRequest({ 'x-alldone-mcp-client': '<a href="x">Evil</a>' })
        const userId = await server.getAuthenticatedUserForClient(request)
        const context = await server.buildDelegatedToolRuntimeContext(userId, request)

        expect(server.isBrowserAgentRequest(request)).toBe(false)
        expect(context.mcpClient).toBeNull()
    })

    test('the bridge sees the same tools as any MCP client, minus the ones switched off', async () => {
        mockDocs.set('users/user-1', { mcpDisabledTools: ['get_contacts'] })
        const response = await server.handleSingleJsonRpc(
            { jsonrpc: '2.0', id: 1, method: 'tools/list' },
            browserRequest()
        )
        const names = response.result.tools.map(tool => tool.name)

        expect(names).toContain('get_tasks')
        expect(names).toContain('create_task')
        expect(names).not.toContain('get_contacts')
    })

    test('switching browser agents off empties the list and refuses calls for the bridge only', async () => {
        mockDocs.set('users/user-1', { browserAgentToolsEnabled: false })

        const listed = await server.handleSingleJsonRpc(
            { jsonrpc: '2.0', id: 1, method: 'tools/list' },
            browserRequest()
        )
        expect(listed.result.tools).toEqual([])

        const called = await server.handleSingleJsonRpc(
            { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_tasks', arguments: {} } },
            browserRequest()
        )
        expect(called.result.isError).toBe(true)
        expect(JSON.parse(called.result.content[0].text).error).toMatch(/Browser agent access is disabled/)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()

        // A connected MCP client (OAuth) is not affected by the browser switch.
        const oauthList = await server.handleSingleJsonRpc(
            { jsonrpc: '2.0', id: 3, method: 'tools/list' },
            { headers: { authorization: `Bearer ${OAUTH_TOKEN}` } }
        )
        expect(oauthList.result.tools.length).toBeGreaterThan(0)
    })

    test('the MCP master switch also stops the bridge', async () => {
        mockDocs.set('users/user-1', { mcpEnabled: false })
        const listed = await server.handleSingleJsonRpc(
            { jsonrpc: '2.0', id: 1, method: 'tools/list' },
            browserRequest()
        )
        expect(listed.result.tools).toEqual([])
    })

    test('a tool call runs as the signed-in user with the browser-agent label', async () => {
        mockExecuteToolNatively.mockResolvedValue({ tasks: [] })
        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 4,
                method: 'tools/call',
                params: { name: 'get_tasks', arguments: { projectId: 'p1' } },
            },
            browserRequest()
        )

        expect(response.result.isError).toBeUndefined()
        expect(JSON.parse(response.result.content[0].text)).toEqual({ tasks: [] })
        expect(mockExecuteToolNatively).toHaveBeenCalledWith(
            'get_tasks',
            expect.anything(),
            'p1',
            null,
            'user-1',
            {},
            expect.objectContaining({ sourceChannel: 'mcp', mcpClient: 'Browser agent' })
        )
    })

    test('a project the user is not a member of is still refused', async () => {
        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 5,
                method: 'tools/call',
                params: { name: 'get_tasks', arguments: { projectId: 'someone-elses-project' } },
            },
            browserRequest()
        )

        expect(response.result.isError).toBe(true)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
    })

    test('two users signed in with ID tokens do not share one rate-limit bucket', () => {
        const first = server.getClientIdFromRequest({ headers: { authorization: `Bearer ${idToken('user-1')}` } })
        const second = server.getClientIdFromRequest({ headers: { authorization: `Bearer ${idToken('user-2')}` } })

        expect(first).toMatch(/^jwt:[0-9a-f]{40}$/)
        expect(first).not.toBe(second)
        // Opaque OAuth tokens keep their existing key.
        expect(server.getClientIdFromRequest({ headers: { authorization: `Bearer ${OAUTH_TOKEN}` } })).toBe(OAUTH_TOKEN)
    })
})
