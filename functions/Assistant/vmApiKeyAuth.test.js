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
    normalizeApiKey,
    removeVmApiKey,
    resolveModeFromData,
    saveVmApiKey,
    setVmCredentialMode,
    testVmApiKey,
    validateProviderApiKey,
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
