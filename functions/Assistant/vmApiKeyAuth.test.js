const mockDocs = {}
const mockBatchSet = jest.fn()
const mockBatchCommit = jest.fn(async () => {})

function docFor(path) {
    if (!mockDocs[path]) {
        mockDocs[path] = {
            get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
            set: jest.fn(async () => {}),
        }
    }
    return mockDocs[path]
}

const mockFirestore = jest.fn(() => ({
    doc: jest.fn(path => docFor(path)),
    batch: jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
}))
mockFirestore.FieldValue = { delete: jest.fn(() => ({ __op: 'delete' })) }

jest.mock('firebase-admin', () => ({ firestore: mockFirestore }))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: mockFirestore.FieldValue }))
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

const {
    getVmApiKeyStatus,
    loadVmApiKey,
    normalizeApiKey,
    removeVmApiKey,
    resolveModeFromData,
    resolveVmCredentialMode,
    saveVmApiKey,
    setVmCredentialMode,
    testVmApiKey,
    validateProviderApiKey,
    VALID_PROVIDERS,
} = require('./vmApiKeyAuth')

describe('VM personal API keys', () => {
    const key = 'sk-test-super-secret-provider-key-123456'

    beforeEach(() => {
        Object.keys(mockDocs).forEach(path => delete mockDocs[path])
        jest.clearAllMocks()
        global.fetch = jest.fn(async () => ({ ok: true, status: 200 }))
    })

    afterAll(() => {
        delete global.fetch
    })

    test('requires an authenticated user and a complete key', async () => {
        await expect(saveVmApiKey({ provider: 'claude', apiKey: key })).rejects.toMatchObject({
            code: 'unauthenticated',
        })
        expect(() => normalizeApiKey('short key')).toThrow('complete provider API key')
    })

    test('validates Anthropic and OpenAI keys with provider auth headers', async () => {
        const anthropicFetch = jest.fn(async () => ({ ok: true, status: 200 }))
        await validateProviderApiKey('claude', key, { fetchImpl: anthropicFetch })
        expect(anthropicFetch).toHaveBeenCalledWith(
            'https://api.anthropic.com/v1/models?limit=1',
            expect.objectContaining({
                headers: expect.objectContaining({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
            })
        )

        const openAiFetch = jest.fn(async () => ({ ok: true, status: 200 }))
        await validateProviderApiKey('codex', key, { fetchImpl: openAiFetch })
        expect(openAiFetch).toHaveBeenCalledWith(
            'https://api.openai.com/v1/models',
            expect.objectContaining({ headers: { Authorization: `Bearer ${key}` } })
        )
    })

    test('rejects invalid provider keys without including the secret in the error', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: false, status: 401 }))
        let error
        try {
            await validateProviderApiKey('claude', key, { fetchImpl })
        } catch (caught) {
            error = caught
        }
        expect(error.code).toBe('invalid-argument')
        expect(error.message).toContain('Anthropic rejected this API key')
        expect(error.message).not.toContain(key)
    })

    test('stores the raw key only in the server-only userSecrets document and opts into BYOK', async () => {
        await saveVmApiKey({ userId: 'user-1', provider: 'claude', apiKey: key })

        expect(mockBatchSet).toHaveBeenCalledWith(
            docFor('userSecrets/user-1/providers/vmAgentApiKeys'),
            expect.objectContaining({ claude: expect.objectContaining({ apiKey: key, validationStatus: 'valid' }) }),
            { merge: true }
        )
        expect(mockBatchSet).toHaveBeenCalledWith(
            docFor('users/user-1/private/vmAgentSubscriptions'),
            expect.objectContaining({ credentialModes: { claude: 'byok' } }),
            { merge: true }
        )
        expect(mockBatchCommit).toHaveBeenCalledTimes(1)
    })

    test('never returns a saved key in status', async () => {
        docFor('userSecrets/user-1/providers/vmAgentApiKeys').get.mockResolvedValue({
            exists: true,
            data: () => ({
                claude: { apiKey: key, validatedAt: 123, validationStatus: 'valid' },
            }),
        })

        const status = await getVmApiKeyStatus('user-1')
        expect(status.claude).toEqual(
            expect.objectContaining({ connected: true, validatedAt: 123, validationStatus: 'valid' })
        )
        expect(JSON.stringify(status)).not.toContain(key)
        expect(status.claude).not.toHaveProperty('apiKey')
    })

    test('preserves legacy routing and gives explicit BYOK selection precedence', () => {
        const subscription = { claude: { oauthToken: 'oauth' } }
        const apiKeys = { claude: { apiKey: key } }
        expect(resolveModeFromData('claude', subscription, apiKeys)).toBe('subscription')
        expect(resolveModeFromData('claude', { ...subscription, credentialModes: { claude: 'byok' } }, apiKeys)).toBe(
            'byok'
        )
        expect(resolveModeFromData('claude', { ...subscription, credentialModes: { claude: 'api' } }, apiKeys)).toBe(
            'api'
        )
    })

    test('does not allow selecting BYOK without a saved key', async () => {
        await expect(setVmCredentialMode({ userId: 'user-1', provider: 'codex', mode: 'byok' })).rejects.toMatchObject({
            code: 'failed-precondition',
        })
    })

    test('removing a key deletes only that provider and falls back to a connected subscription', async () => {
        docFor('users/user-1/private/vmAgentSubscriptions').get.mockResolvedValue({
            exists: true,
            data: () => ({ codex: { authJson: '{"tokens":{}}' } }),
        })

        const result = await removeVmApiKey({ userId: 'user-1', provider: 'codex' })
        expect(result.activeMode).toBe('subscription')
        expect(mockBatchSet).toHaveBeenCalledWith(
            docFor('userSecrets/user-1/providers/vmAgentApiKeys'),
            expect.objectContaining({ codex: { __op: 'delete' } }),
            { merge: true }
        )
    })

    test('testing a revoked saved key marks only status invalid and never writes an error or key to public data', async () => {
        const secretRef = docFor('userSecrets/user-1/providers/vmAgentApiKeys')
        secretRef.get.mockResolvedValue({
            exists: true,
            data: () => ({ codex: { apiKey: key, connectedAt: 1 } }),
        })
        global.fetch.mockResolvedValue({ ok: false, status: 401 })

        await expect(testVmApiKey({ userId: 'user-1', provider: 'codex' })).rejects.toThrow(
            'OpenAI rejected this API key'
        )
        expect(secretRef.set).toHaveBeenCalledWith(
            expect.objectContaining({ codex: expect.objectContaining({ validationStatus: 'invalid' }) }),
            { merge: true }
        )
        expect(JSON.stringify(secretRef.set.mock.calls)).not.toContain('OpenAI rejected')
    })
})

// AT-2230 BYOK: OpenRouter is a credential provider in its own right — same storage, same secrecy
// guarantees, but no subscription route and its own validation endpoint.
describe('OpenRouter as a BYOK credential provider', () => {
    const key = 'sk-or-v1-0123456789abcdef0123456789abcdef'

    beforeEach(() => {
        Object.keys(mockDocs).forEach(path => delete mockDocs[path])
        jest.clearAllMocks()
        global.fetch = jest.fn(async () => ({ ok: true, status: 200 }))
    })

    afterAll(() => {
        delete global.fetch
    })

    test('is an accepted provider alongside claude and codex', () => {
        expect(VALID_PROVIDERS).toEqual(['claude', 'codex', 'openrouter'])
    })

    // The models endpoint is PUBLIC: it answers 200 for any string, so validating against it would
    // "accept" every typo and only fail later, mid-run, inside the sandbox. /key needs the credential.
    test('validates against the authenticated /key endpoint, not the public /models one', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }))
        await validateProviderApiKey('openrouter', key, { fetchImpl })

        expect(fetchImpl).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/key',
            expect.objectContaining({ headers: { Authorization: `Bearer ${key}` } })
        )
        expect(fetchImpl.mock.calls[0][0]).not.toContain('/models')
    })

    test('rejects a bad key without echoing the secret', async () => {
        const fetchImpl = jest.fn(async () => ({ ok: false, status: 401 }))
        let error
        try {
            await validateProviderApiKey('openrouter', key, { fetchImpl })
        } catch (caught) {
            error = caught
        }
        expect(error.code).toBe('invalid-argument')
        expect(error.message).toContain('OpenRouter rejected this API key')
        expect(error.message).not.toContain(key)
    })

    test('stores the key server-side only and opts that provider into BYOK', async () => {
        await saveVmApiKey({ userId: 'user-1', provider: 'openrouter', apiKey: key })

        expect(mockBatchSet).toHaveBeenCalledWith(
            docFor('userSecrets/user-1/providers/vmAgentApiKeys'),
            expect.objectContaining({ openrouter: expect.objectContaining({ apiKey: key }) }),
            { merge: true }
        )
        // Saving one provider must never move another's route.
        expect(mockBatchSet).toHaveBeenCalledWith(
            docFor('users/user-1/private/vmAgentSubscriptions'),
            expect.objectContaining({ credentialModes: { openrouter: 'byok' } }),
            { merge: true }
        )
    })

    test('never returns the saved key in status', async () => {
        docFor('userSecrets/user-1/providers/vmAgentApiKeys').get.mockResolvedValue({
            exists: true,
            data: () => ({ openrouter: { apiKey: key, validationStatus: 'valid' } }),
        })

        const status = await getVmApiKeyStatus('user-1')
        expect(status.openrouter).toEqual(expect.objectContaining({ connected: true }))
        expect(JSON.stringify(status)).not.toContain(key)
    })

    test('has no subscription route: selecting one is refused with an actionable message', async () => {
        await expect(
            setVmCredentialMode({ userId: 'user-1', provider: 'openrouter', mode: 'subscription' })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    // The heart of the separation. A connected ChatGPT subscription authenticates against OpenAI and
    // cannot serve DeepSeek, so it must not leak into the OpenRouter slot's resolved mode.
    test('a connected codex subscription does not make OpenRouter subscription-billed', () => {
        const subscription = { codex: { authJson: '{}' }, claude: { oauthToken: 'oauth' } }
        expect(resolveModeFromData('openrouter', subscription, {})).toBe('api')
        expect(resolveModeFromData('openrouter', subscription, { openrouter: { apiKey: key } })).toBe('api')
        expect(
            resolveModeFromData(
                'openrouter',
                { ...subscription, credentialModes: { openrouter: 'byok' } },
                { openrouter: { apiKey: key } }
            )
        ).toBe('byok')
        // 'subscription' is unreachable for this provider even if the field were somehow written.
        expect(
            resolveModeFromData('openrouter', { ...subscription, credentialModes: { openrouter: 'subscription' } }, {})
        ).toBe('api')
    })

    test('resolveVmCredentialMode reads the openrouter slot independently of codex', async () => {
        docFor('users/user-1/private/vmAgentSubscriptions').get.mockResolvedValue({
            exists: true,
            data: () => ({ codex: { authJson: '{}' }, credentialModes: { codex: 'subscription' } }),
        })
        docFor('userSecrets/user-1/providers/vmAgentApiKeys').get.mockResolvedValue({
            exists: true,
            data: () => ({ codex: { apiKey: 'sk-openai-key-1234567890abcdef' } }),
        })

        expect(await resolveVmCredentialMode('user-1', 'codex')).toBe('subscription')
        expect(await resolveVmCredentialMode('user-1', 'openrouter')).toBe('api')
    })

    test('loadVmApiKey returns the OpenRouter key for the openrouter slot only', async () => {
        docFor('userSecrets/user-1/providers/vmAgentApiKeys').get.mockResolvedValue({
            exists: true,
            data: () => ({
                openrouter: { apiKey: key },
                codex: { apiKey: 'sk-openai-key-1234567890abcdef' },
            }),
        })

        expect(await loadVmApiKey('user-1', 'openrouter')).toBe(key)
        expect(await loadVmApiKey('user-1', 'codex')).toBe('sk-openai-key-1234567890abcdef')
        expect(await loadVmApiKey('user-1', 'nonsense')).toBeNull()
    })

    test('removing the key falls back to Alldone Gold, never to another provider\u2019s subscription', async () => {
        docFor('users/user-1/private/vmAgentSubscriptions').get.mockResolvedValue({
            exists: true,
            data: () => ({ codex: { authJson: '{}' } }),
        })

        const result = await removeVmApiKey({ userId: 'user-1', provider: 'openrouter' })
        expect(result.activeMode).toBe('api')
        expect(mockBatchSet).toHaveBeenCalledWith(
            docFor('users/user-1/private/vmAgentSubscriptions'),
            expect.objectContaining({ credentialModes: { openrouter: 'api' } }),
            { merge: true }
        )
    })
})
