const mockSet = jest.fn(async () => {})
const mockUpdate = jest.fn(async () => {})
const mockGet = jest.fn(async () => ({ exists: false, data: () => ({}) }))
const mockTransactionGet = jest.fn(async () => mockGet())
const mockTransactionUpdate = jest.fn()
const mockRunTransaction = jest.fn(async callback =>
    callback({ get: mockTransactionGet, update: mockTransactionUpdate })
)

const mockFirestore = jest.fn(() => ({
    doc: jest.fn(() => ({ get: mockGet, set: mockSet, update: mockUpdate })),
    runTransaction: mockRunTransaction,
}))
mockFirestore.FieldValue = { delete: jest.fn(() => ({ __op: 'delete' })) }

jest.mock('firebase-admin', () => ({
    firestore: mockFirestore,
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

const {
    connectVmSubscription,
    getVmSubscriptionCredentialVersion,
    loadVmSubscriptionAuth,
    normalizeClaudeOauthToken,
    parseCodexAuthJson,
    persistRefreshedCodexAuth,
} = require('./vmSubscriptionAuth')

describe('VM subscription credentials', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGet.mockResolvedValue({ exists: false, data: () => ({}) })
    })

    test('accepts a complete Claude setup token and rejects whitespace', () => {
        expect(normalizeClaudeOauthToken('  claude-oauth-token-1234567890  ')).toBe('claude-oauth-token-1234567890')
        expect(() => normalizeClaudeOauthToken('claude oauth token 1234567890')).toThrow(
            'Paste the complete OAuth token'
        )
    })

    test('requires Codex ChatGPT auth with a refresh token', () => {
        expect(
            parseCodexAuthJson(JSON.stringify({ auth_mode: 'chatgpt', tokens: { refresh_token: 'refresh-token' } }))
        ).toEqual({ auth_mode: 'chatgpt', tokens: { refresh_token: 'refresh-token' } })
        expect(() => parseCodexAuthJson(JSON.stringify({ auth_mode: 'apikey' }))).toThrow(
            'must use auth_mode "chatgpt"'
        )
    })

    test('stores only the selected provider credential in the private document', async () => {
        await connectVmSubscription({
            userId: 'user-1',
            provider: 'codex',
            credential: JSON.stringify({ auth_mode: 'chatgpt', tokens: { refresh_token: 'refresh-token' } }),
        })

        expect(mockSet).toHaveBeenCalledWith(
            expect.objectContaining({
                codex: expect.objectContaining({
                    authJson: JSON.stringify({
                        auth_mode: 'chatgpt',
                        tokens: { refresh_token: 'refresh-token' },
                    }),
                }),
            }),
            { merge: true }
        )
    })

    test('loads a stable credential version without marking polling reads as used', async () => {
        const credential = JSON.stringify({
            tokens: { refresh_token: 'refresh-token' },
            auth_mode: 'chatgpt',
        })
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ codex: { authJson: credential } }),
        })

        const auth = await loadVmSubscriptionAuth('user-1', 'codex', { markUsed: false })

        expect(auth).toEqual({
            provider: 'codex',
            credential,
            credentialVersion: getVmSubscriptionCredentialVersion(
                'codex',
                JSON.stringify({ auth_mode: 'chatgpt', tokens: { refresh_token: 'refresh-token' } })
            ),
            mode: 'subscription',
        })
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    test('does not write an unchanged Codex auth file back to storage', async () => {
        const credential = JSON.stringify({
            auth_mode: 'chatgpt',
            tokens: { refresh_token: 'refresh-token' },
            last_refresh: '2026-07-19T09:00:00.000Z',
        })
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ codex: { authJson: credential } }),
        })

        await expect(
            persistRefreshedCodexAuth('user-1', credential, getVmSubscriptionCredentialVersion('codex', credential))
        ).resolves.toBe(false)
        expect(mockTransactionUpdate).not.toHaveBeenCalled()
    })

    test('prevents a stale VM from overwriting a newer Codex credential', async () => {
        const staleCredential = JSON.stringify({
            auth_mode: 'chatgpt',
            tokens: { refresh_token: 'stale-refresh-token' },
            last_refresh: '2026-07-19T09:00:00.000Z',
        })
        const currentCredential = JSON.stringify({
            auth_mode: 'chatgpt',
            tokens: { refresh_token: 'current-refresh-token' },
            last_refresh: '2026-07-19T09:05:00.000Z',
        })
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ codex: { authJson: currentCredential } }),
        })

        await expect(
            persistRefreshedCodexAuth(
                'user-1',
                staleCredential,
                getVmSubscriptionCredentialVersion('codex', staleCredential)
            )
        ).resolves.toBe(false)
        expect(mockTransactionUpdate).not.toHaveBeenCalled()
    })

    test('persists a refreshed Codex credential when storage still has the version the VM used', async () => {
        const previousCredential = JSON.stringify({
            auth_mode: 'chatgpt',
            tokens: { refresh_token: 'previous-refresh-token' },
            last_refresh: '2026-07-19T09:00:00.000Z',
        })
        const refreshedCredential = JSON.stringify({
            auth_mode: 'chatgpt',
            tokens: { refresh_token: 'refreshed-token' },
            last_refresh: '2026-07-19T09:05:00.000Z',
        })
        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ codex: { authJson: previousCredential } }),
        })

        await expect(
            persistRefreshedCodexAuth(
                'user-1',
                refreshedCredential,
                getVmSubscriptionCredentialVersion('codex', previousCredential)
            )
        ).resolves.toBe(true)
        expect(mockTransactionUpdate).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({ 'codex.authJson': refreshedCredential })
        )
    })
})
