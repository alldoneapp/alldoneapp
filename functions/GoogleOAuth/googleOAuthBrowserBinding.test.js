// NV-23: a Google connect flow must be completed by the browser that started it. A forwarded consent
// URL completed in someone else's browser must never put that person's tokens on the initiator.
const mockDocs = new Map()
const mockGetToken = jest.fn()

jest.mock('firebase-admin', () => {
    const doc = path => ({
        get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
        set: async data => mockDocs.set(path, data),
        delete: async () => mockDocs.delete(path),
    })
    const firestore = () => ({
        doc,
        collection: name => ({ doc: id => doc(`${name}/${id}`) }),
    })
    firestore.Timestamp = { now: jest.fn(), fromDate: jest.fn() }
    return { firestore, app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })) }
})
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { delete: jest.fn() },
    Timestamp: { now: () => 'now', fromDate: date => ({ toDate: () => date }) },
}))
jest.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: jest.fn().mockImplementation(() => ({
                generateAuthUrl: options => `https://accounts.google.com/o/oauth2/auth?state=${options.state}`,
                getToken: (...args) => mockGetToken(...args),
            })),
        },
        oauth2: jest.fn(),
    },
}))
jest.mock('../envFunctionsHelper.js', () => ({
    getEnvFunctions: jest.fn(() => ({ GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' })),
}))

const { hashBrowserNonce } = require('../Utils/oauthBrowserBinding')
const { initiateOAuth, handleOAuthCallback } = require('./googleOAuthHandler')

const NONCE = 'n'.repeat(43)
const stateFrom = authUrl => decodeURIComponent(new URL(authUrl).searchParams.get('state'))
const requestWithCookie = cookie => ({ headers: cookie ? { cookie } : {} })

beforeEach(() => {
    mockDocs.clear()
    mockGetToken.mockReset().mockRejectedValue(new Error('EXCHANGED'))
})

describe('Google connect browser binding (NV-23)', () => {
    test('refuses to start without a browser binding or with a foreign return URL', async () => {
        await expect(initiateOAuth('attacker', 'p1', 'gmail', null, null, null)).rejects.toThrow('Refresh Alldone')
        await expect(
            initiateOAuth('attacker', 'p1', 'gmail', 'https://evil.example.test/landing', null, hashBrowserNonce(NONCE))
        ).rejects.toThrow('returnUrl')
    })

    test('stores only the hash of the browser nonce with the state', async () => {
        const state = stateFrom(await initiateOAuth('u1', 'p1', 'gmail', null, null, hashBrowserNonce(NONCE)))
        expect(mockDocs.get(`googleOAuthStates/${state}`)).toMatchObject({
            userId: 'u1',
            browserNonceHash: hashBrowserNonce(NONCE),
        })
        expect(JSON.stringify(mockDocs.get(`googleOAuthStates/${state}`))).not.toContain(NONCE)
    })

    test('a consent completed in another browser is refused before the code is exchanged', async () => {
        const state = stateFrom(await initiateOAuth('attacker', 'p1', 'gmail', null, null, hashBrowserNonce(NONCE)))

        await expect(
            handleOAuthCallback('code-of-the-victim', state, { request: requestWithCookie(null) })
        ).rejects.toThrow('different browser')
        expect(mockGetToken).not.toHaveBeenCalled()
        // The state is spent, so the attacker cannot retry it from their own browser.
        expect(mockDocs.has(`googleOAuthStates/${state}`)).toBe(false)
    })

    test('a wrong nonce is refused too', async () => {
        const state = stateFrom(await initiateOAuth('attacker', 'p1', 'gmail', null, null, hashBrowserNonce(NONCE)))
        await expect(
            handleOAuthCallback('code', state, { request: requestWithCookie(`__session=${'x'.repeat(43)}`) })
        ).rejects.toThrow('different browser')
        expect(mockGetToken).not.toHaveBeenCalled()
    })

    test('the browser that started the flow completes it', async () => {
        const state = stateFrom(await initiateOAuth('u1', 'p1', 'gmail', null, null, hashBrowserNonce(NONCE)))
        await expect(
            handleOAuthCallback('code', state, { request: requestWithCookie(`other=1; __session=${NONCE}`) })
        ).rejects.toThrow('EXCHANGED')
        expect(mockGetToken).toHaveBeenCalledWith('code')
    })

    test('a state stored before the binding existed cannot be completed', async () => {
        mockDocs.set('googleOAuthStates/legacy', {
            userId: 'u1',
            projectId: 'p1',
            service: 'gmail',
            expiresAt: { toDate: () => new Date(Date.now() + 60000) },
        })
        await expect(
            handleOAuthCallback('code', 'legacy', { request: requestWithCookie(`__session=${NONCE}`) })
        ).rejects.toThrow('different browser')
        expect(mockGetToken).not.toHaveBeenCalled()
    })
})
