// NV-23: the MCP client authorization flow must be completed by the browser that started it. A
// forwarded authorization URL completed elsewhere must not put that person's tokens on the
// initiator's assistant.
const mockDocs = new Map()
jest.mock('firebase-admin', () => ({
    firestore: () => ({
        doc: path => ({
            get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
            set: async data => mockDocs.set(path, { ...(mockDocs.get(path) || {}), ...data }),
            delete: async () => mockDocs.delete(path),
        }),
    }),
}))
jest.mock(
    'firebase-functions/v2/https',
    () => ({
        HttpsError: class HttpsError extends Error {
            constructor(code, message) {
                super(message)
                this.code = code
            }
        },
    }),
    { virtual: true }
)

const { hashBrowserNonce } = require('../Utils/oauthBrowserBinding')
const { beginMcpOAuth, exchangeMcpOAuthCode } = require('./mcpClientOAuth')

const NONCE = 'q'.repeat(43)
const seedSession = (overrides = {}) =>
    mockDocs.set('mcpOAuthSessions/s1', {
        userId: 'attacker',
        status: 'pending',
        expiresAt: Date.now() + 60000,
        browserNonceHash: hashBrowserNonce(NONCE),
        ...overrides,
    })

beforeEach(() => mockDocs.clear())

describe('MCP client OAuth browser binding (NV-23)', () => {
    test('refuses to start without a browser binding', async () => {
        await expect(beginMcpOAuth({ userId: 'u1', serverUrl: 'https://mcp.example.test' })).rejects.toMatchObject({
            code: 'failed-precondition',
        })
    })

    test('a code delivered to another browser is refused, and the session is spent', async () => {
        seedSession()
        await expect(exchangeMcpOAuthCode({ code: 'c', state: 's1', request: { headers: {} } })).rejects.toThrow(
            'different browser'
        )
        expect(mockDocs.has('mcpOAuthSessions/s1')).toBe(false)
    })

    test('a session from before the binding cannot be completed', async () => {
        seedSession({ browserNonceHash: undefined })
        await expect(
            exchangeMcpOAuthCode({ code: 'c', state: 's1', request: { headers: { cookie: `__session=${NONCE}` } } })
        ).rejects.toThrow('different browser')
    })

    test('the starting browser gets past the binding to the code exchange', async () => {
        const originalFetch = global.fetch
        global.fetch = jest.fn(async () => {
            throw new Error('no network in tests')
        })
        seedSession({ authorizationServerUrl: 'https://as.example.test', clientInformation: { client_id: 'x' } })
        const result = exchangeMcpOAuthCode({
            code: 'c',
            state: 's1',
            request: { headers: { cookie: `__session=${NONCE}` } },
        })
        // The exchange itself talks to the authorization server, which this test does not stand up.
        await expect(result).rejects.not.toThrow('different browser')
        expect(mockDocs.has('mcpOAuthSessions/s1')).toBe(true)
        global.fetch = originalFetch
    })
})
