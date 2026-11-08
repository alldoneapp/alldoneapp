const vm = require('node:vm')
const { Timestamp } = require('firebase-admin/firestore')

const mockVerifyIdToken = jest.fn()
const mockDb = { collection: jest.fn(), runTransaction: jest.fn() }
jest.mock('firebase-admin', () => ({
    auth: () => ({ verifyIdToken: mockVerifyIdToken }),
    firestore: () => mockDb,
}))
jest.mock('../config/environments.js', () => ({ getEnvironmentConfig: () => ({ firebaseWeb: {} }) }))

const { CloudOAuthHandler } = require('./cloudOAuth')

describe('MCP OAuth callback recovery', () => {
    let handler, documents, failCommit, transactionQueue
    const authorization = {
        authCode: 'auth-test',
        redirectUri: 'https://chatgpt.com/connector/oauth/test',
        state: 'state-test',
    }
    const validAuth = () => ({
        sessionId: 'login-test',
        redirectUri: authorization.redirectUri,
        state: authorization.state,
        status: 'pending',
        expiresAt: Timestamp.fromMillis(Date.now() + 1800000),
    })
    const complete = overrides =>
        handler.handleOAuthCallback('login-test', 'firebase-test', { ...authorization, ...overrides })
    const sessions = () => [...documents.keys()].filter(key => key.startsWith('mcpSessions/'))

    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
        documents = new Map([['oauthAuthSessions/auth-test', validAuth()]])
        transactionQueue = Promise.resolve()
        failCommit = false
        mockVerifyIdToken.mockResolvedValue({ uid: 'user-test', email: 'test@example.com' })
        mockDb.collection.mockImplementation(collection => ({
            doc: id => ({ id, path: `${collection}/${id}` }),
        }))
        // Serialize competing transactions, as Firestore does through conflict
        // retries, and apply writes only after the callback completes successfully.
        mockDb.runTransaction.mockImplementation(callback => {
            const transaction = transactionQueue.then(async () => {
                const writes = []
                const result = await callback({
                    get: async ref => ({ exists: documents.has(ref.path), data: () => documents.get(ref.path) }),
                    set: (ref, data) => writes.push([ref.path, data]),
                    update: (ref, data) => writes.push([ref.path, { ...documents.get(ref.path), ...data }]),
                })
                if (failCommit) throw Object.assign(new Error('Unavailable'), { code: 14 })
                writes.forEach(([path, data]) => documents.set(path, data))
                return result
            })
            transactionQueue = transaction.catch(() => {})
            return transaction
        })
        handler = new CloudOAuthHandler()
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    test('concurrent callbacks and a later retry reuse one completed session', async () => {
        const results = await Promise.all([complete(), complete()])
        expect(results[0].success).toBe(true)
        expect(results[1]).toEqual(results[0])
        expect(await complete()).toEqual(results[0])
        expect(sessions()).toHaveLength(1)
        expect(documents.get('mcpUserSessions/user-test').sessionId).toBe(results[0].sessionId)
        expect(documents.get('mcpUserAuth/test@example.com').sessionId).toBe(results[0].sessionId)
        expect(results[0].bearerToken).toBeUndefined()
        expect(new URL(results[0].redirect_to).searchParams.get('state')).toBe('state-test')
    })

    test('a failed transaction leaves no partial session and can be retried', async () => {
        failCommit = true
        expect(await complete()).toMatchObject({ success: false, retryable: true })
        expect(sessions()).toHaveLength(0)
        expect(documents.get('oauthAuthSessions/auth-test').status).toBe('pending')
        failCommit = false
        expect(await complete()).toMatchObject({ success: true })
        expect(sessions()).toHaveLength(1)
    })

    test.each([
        ['session mismatch', { sessionId: 'another-login' }, {}],
        ['redirect mismatch', {}, { redirectUri: 'https://other.example/callback' }],
        ['state mismatch', {}, { state: 'another-state' }],
        ['expired authorization', { expiresAt: Timestamp.fromMillis(0) }, {}],
        ['unavailable authorization', { status: 'revoked' }, {}],
    ])('rejects %s before creating any session', async (_, stored, request) => {
        documents.set('oauthAuthSessions/auth-test', { ...validAuth(), ...stored })
        expect(await complete(request)).toMatchObject({ success: false })
        expect(sessions()).toHaveLength(0)
        expect(documents.has('mcpUserAuth/test@example.com')).toBe(false)
    })

    test('a different user cannot replace a completed authorization', async () => {
        const first = await complete()
        mockVerifyIdToken.mockResolvedValue({ uid: 'another-user', email: 'another@example.com' })
        expect(await complete()).toMatchObject({ success: false })
        expect(documents.get('oauthAuthSessions/auth-test').mcpSessionId).toBe(first.sessionId)
        expect(sessions()).toHaveLength(1)
    })

    test('a consumed authorization code cannot create a new session', async () => {
        await complete()
        documents.delete('oauthAuthSessions/auth-test')
        expect(await complete()).toMatchObject({ success: false })
        expect(sessions()).toHaveLength(1)
    })

    const loginPage = fetch => {
        const elements = Object.fromEntries(
            ['loginBtn', 'closeBtn', 'status'].map(id => [
                id,
                {
                    classList: { add: jest.fn(), remove: jest.fn() },
                    addEventListener: jest.fn(function (_, callback) {
                        this.click = callback
                    }),
                },
            ])
        )
        const signInWithPopup = jest.fn().mockResolvedValue({ user: { getIdToken: async () => 'firebase-test' } })
        const firebaseAuth = Object.assign(() => ({ signInWithPopup }), {
            GoogleAuthProvider: class {
                addScope() {}
            },
        })
        const html = handler.generateAuthPage(
            'login-test',
            authorization.authCode,
            authorization.redirectUri,
            authorization.state
        )
        const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]
        vm.runInNewContext(script, {
            firebase: { initializeApp: jest.fn(), auth: firebaseAuth },
            document: { getElementById: id => elements[id] },
            window: { location: { origin: 'https://my.alldone.app' } },
            fetch,
            AbortController,
            setTimeout,
            clearTimeout,
            console: { log: jest.fn(), error: jest.fn() },
        })
        return { elements, signInWithPopup }
    }

    test('the actual login script recovers a lost response without another Google sign-in', async () => {
        const requests = []
        const fetch = jest.fn(async (url, options) => {
            requests.push({ url, ...options })
            const payload = JSON.parse(options.body)
            const result = await handler.handleOAuthCallback(payload.sessionId, payload.firebaseToken, payload)
            if (requests.length === 1) throw new TypeError('Failed to fetch')
            return { ok: true, status: 200, json: async () => result }
        })
        const { elements, signInWithPopup } = loginPage(fetch)
        const clicked = elements.loginBtn.click()
        await jest.advanceTimersByTimeAsync(1000)
        await clicked
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(signInWithPopup).toHaveBeenCalledTimes(1)
        expect(sessions()).toHaveLength(1)
        expect(requests[0].url).toBe('https://my.alldone.app/mcpOAuthCallback')
        expect(requests[0].method).toBe('POST')
        expect(requests[1].body).toBe(requests[0].body)
        expect(elements.status.innerHTML).toContain('Authentication successful')
    })

    test('bounded automatic retries offer manual recovery without repeating Google sign-in', async () => {
        const fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'))
        const { elements, signInWithPopup } = loginPage(fetch)
        const clicked = elements.loginBtn.click()
        await jest.advanceTimersByTimeAsync(3000)
        await clicked
        expect(fetch).toHaveBeenCalledTimes(3)
        expect(elements.loginBtn.disabled).toBe(false)
        expect(elements.loginBtn.textContent).toBe('Retry connection')
        fetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: true, redirect_to: authorization.redirectUri }),
        })
        await elements.loginBtn.click()
        expect(signInWithPopup).toHaveBeenCalledTimes(1)
        expect(elements.status.innerHTML).toContain('Authentication successful')
    })

    test('authorization rejection is not retried and resets Google sign-in', async () => {
        const fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ success: false, error: 'Authorization expired' }),
        })
        const { elements } = loginPage(fetch)
        await elements.loginBtn.click()
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(elements.loginBtn.textContent).toBe('Sign in with Google')
        expect(elements.status.innerHTML).toContain('Authorization expired')
    })
})
