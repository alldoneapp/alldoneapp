const mockSet = jest.fn(async () => {})
const mockUpdate = jest.fn(async () => {})
const mockGet = jest.fn(async () => ({ exists: false, data: () => ({}) }))

const mockFirestore = jest.fn(() => ({
    doc: jest.fn(() => ({ get: mockGet, set: mockSet, update: mockUpdate })),
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

const { connectVmSubscription, normalizeClaudeOauthToken, parseCodexAuthJson } = require('./vmSubscriptionAuth')

describe('VM subscription credentials', () => {
    beforeEach(() => {
        jest.clearAllMocks()
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
})
