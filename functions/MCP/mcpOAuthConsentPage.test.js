'use strict'

// security audit 2026-11 (mcp-oauth-dcr-authorize-without-client-consent): the MCP login page names
// the app that started the authorization and the host it redirects to, read from the STORED
// authorization and client registration, never from the page's own query string.

const mockDocs = new Map()
jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        collection: jest.fn(collection => ({
            doc: jest.fn(id => ({
                get: jest.fn(async () => {
                    const data = mockDocs.get(`${collection}/${id}`)
                    return { exists: !!data, data: () => data }
                }),
                set: jest.fn(async data => mockDocs.set(`${collection}/${id}`, data)),
            })),
        })),
    })),
    app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })),
}))
jest.mock('./config/environments.js', () => ({
    getEnvironmentConfig: jest.fn(() => ({ mcpBaseUrl: 'https://my.alldone.app', firebaseWeb: {} })),
}))
jest.mock('firebase-functions/params', () => ({ defineString: jest.fn(() => ({ value: jest.fn(() => '') })) }), {
    virtual: true,
})
jest.mock('../Assistant/assistantHelper', () => ({ executeToolNatively: jest.fn() }))

const { AlldoneSimpleMCPServer } = require('./mcpServerSimple')
const { CloudOAuthHandler } = require('./auth/cloudOAuth')

describe('the MCP login page', () => {
    let server, res

    beforeEach(() => {
        mockDocs.clear()
        server = Object.create(AlldoneSimpleMCPServer.prototype)
        server.oauthHandler = new CloudOAuthHandler()
        res = { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), send: jest.fn(), json: jest.fn() }
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => jest.restoreAllMocks())

    const openLogin = query =>
        server.handleRequest(
            { method: 'GET', path: '/mcpServer/auth/login', url: '/mcpServer/auth/login', query, headers: {} },
            res
        )

    it('names a self-registered client and its stored redirect host, whatever the query says', async () => {
        mockDocs.set('oauthAuthSessions/auth_1', {
            clientId: 'alldone-mcp-evil',
            redirectUri: 'https://evil-mcp-client.example.test/cb',
        })
        mockDocs.set('oauthClients/alldone-mcp-evil', { clientName: 'Claude' })

        await openLogin({
            session_id: 'login-1',
            auth_code: 'auth_1',
            redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        })

        const html = res.send.mock.calls[0][0]
        expect(html).toContain('<strong id="redirectHost">evil-mcp-client.example.test</strong>')
        expect(html).toContain('has not verified this app')
        expect(html).toContain('Allow and sign in with Google')
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store')
    })

    it('names Claude for a registration that really redirects to claude.ai', async () => {
        mockDocs.set('oauthAuthSessions/auth_2', {
            clientId: 'alldone-mcp-claude',
            redirectUri: 'https://claude.ai/api/mcp/auth_callback',
        })
        mockDocs.set('oauthClients/alldone-mcp-claude', {})

        await openLogin({ session_id: 'login-2', auth_code: 'auth_2' })

        const html = res.send.mock.calls[0][0]
        expect(html).toContain('<strong id="clientName">Claude</strong>')
        expect(html).toContain('<strong id="redirectHost">claude.ai</strong>')
        expect(html).not.toContain('has not verified this app')
    })

    it('records the self-declared name of a dynamically registered client', async () => {
        server.checkRateLimits = jest.fn().mockResolvedValue({ allowed: true })
        await server.handleRequest(
            {
                method: 'POST',
                path: '/mcpServer/register',
                url: '/mcpServer/register',
                body: { client_name: 'My\nAgent', redirect_uris: ['https://agent.example/cb'] },
                headers: {},
            },
            res
        )
        const stored = [...mockDocs.entries()].find(([key]) => key.startsWith('oauthClients/'))[1]
        expect(stored.clientName).toBe('My Agent')
    })
})
