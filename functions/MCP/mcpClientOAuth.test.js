jest.mock('firebase-admin', () => {
    const set = jest.fn(async () => {})
    const firestore = () => ({ doc: () => ({ set }) })
    return { firestore, __set: set }
})
jest.mock('../Utils/HelperFunctionsCloud', () => ({ getBaseUrl: () => 'https://my.alldone.app' }))

const { beginMcpOAuth, assertDiscoveredEndpointsBound, createGuardedFetch } = require('./mcpClientOAuth')

const publicLookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }])

function fakeAuth({ metadata, registerError } = {}) {
    return {
        discoverOAuthServerInfo: jest.fn(async () => ({
            authorizationServerUrl: 'https://auth.example.com',
            authorizationServerMetadata: metadata || {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                registration_endpoint: 'https://auth.example.com/register',
            },
            resourceMetadata: null,
        })),
        registerClient: jest.fn(async () => {
            if (registerError) throw registerError
            return { client_id: 'c1' }
        }),
        startAuthorization: jest.fn(async () => ({
            authorizationUrl: new URL('https://auth.example.com/authorize?x=1'),
            codeVerifier: 'v',
        })),
    }
}

describe('beginMcpOAuth outbound policy (NV-25)', () => {
    test.each([
        'http://mcp.example.com/mcp',
        'https://127.0.0.1/mcp',
        'https://[::ffff:7f00:1]/mcp',
        'https://metadata.google.internal./',
        'https://localhost./mcp',
    ])('refuses %s before any request', async serverUrl => {
        const auth = fakeAuth()
        await expect(beginMcpOAuth({ userId: 'u1', serverUrl }, { auth, lookup: publicLookup })).rejects.toMatchObject({
            code: 'invalid-argument',
        })
        expect(auth.discoverOAuthServerInfo).not.toHaveBeenCalled()
    })

    test('refuses a public name that resolves privately', async () => {
        const auth = fakeAuth()
        const lookup = jest.fn(async () => [{ address: '10.0.0.7', family: 4 }])
        await expect(
            beginMcpOAuth({ userId: 'u1', serverUrl: 'https://mcp.example.com/mcp' }, { auth, lookup })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    test('hands the SDK a guarded fetch and completes for a well-formed server', async () => {
        const auth = fakeAuth()
        const result = await beginMcpOAuth(
            { userId: 'u1', serverUrl: 'https://mcp.example.com/mcp' },
            { auth, lookup: publicLookup }
        )
        expect(result.authorizationUrl).toBe('https://auth.example.com/authorize?x=1')
        expect(typeof auth.discoverOAuthServerInfo.mock.calls[0][1].fetchFn).toBe('function')
        expect(typeof auth.registerClient.mock.calls[0][1].fetchFn).toBe('function')
    })

    test('refuses a registration endpoint on another origin, without calling it', async () => {
        const auth = fakeAuth({
            metadata: {
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                registration_endpoint: 'https://internal.example.net/register',
            },
        })
        await expect(
            beginMcpOAuth({ userId: 'u1', serverUrl: 'https://mcp.example.com/mcp' }, { auth, lookup: publicLookup })
        ).rejects.toMatchObject({ code: 'failed-precondition' })
        expect(auth.registerClient).not.toHaveBeenCalled()
    })

    test('does not return the remote response body in the error', async () => {
        const auth = fakeAuth({ registerError: new Error('HTTP 500: SECRET-INTERNAL-BODY') })
        const error = await beginMcpOAuth(
            { userId: 'u1', serverUrl: 'https://mcp.example.com/mcp' },
            { auth, lookup: publicLookup }
        ).catch(e => e)
        expect(error.code).toBe('failed-precondition')
        expect(error.message).not.toMatch(/SECRET-INTERNAL-BODY/)
    })

    test('endpoint binding rejects http token endpoints and cross-origin ones', () => {
        expect(() =>
            assertDiscoveredEndpointsBound('https://a.example.com', { token_endpoint: 'http://a.example.com/t' })
        ).toThrow()
        expect(() =>
            assertDiscoveredEndpointsBound('https://a.example.com', { token_endpoint: 'https://b.example.com/t' })
        ).toThrow()
        expect(() => assertDiscoveredEndpointsBound('http://a.example.com', {})).toThrow()
        expect(() =>
            assertDiscoveredEndpointsBound('https://a.example.com', { token_endpoint: 'https://a.example.com/t' })
        ).not.toThrow()
    })

    test('the guarded fetch re-checks redirects and uses manual redirect mode', async () => {
        const fetchImpl = jest.fn(async () => ({
            status: 302,
            headers: new Headers({ location: 'https://169.254.169.254/' }),
        }))
        const guarded = createGuardedFetch({ fetchImpl, lookup: publicLookup })
        await expect(guarded(new URL('https://auth.example.com/.well-known/x'), {})).rejects.toThrow()
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual')
    })
})
