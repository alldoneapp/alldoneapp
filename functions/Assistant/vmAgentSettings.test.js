const mockGet = jest.fn()
const mockUpdate = jest.fn(async () => {})
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }))

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ doc: mockDoc })),
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

const { SYSTEM_DEFAULT_VM_AGENT, getVmAgentSettings, resolveVmAgent, setDefaultVmAgent } = require('./vmAgentSettings')

describe('VM agent settings', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGet.mockResolvedValue({ exists: true, data: () => ({}) })
    })

    test('uses an explicit agent without reading the user default', async () => {
        await expect(resolveVmAgent('user-1', 'codex')).resolves.toBe('codex')
        expect(mockGet).not.toHaveBeenCalled()
    })

    test('uses the stored user default when no agent is explicit', async () => {
        mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ defaultVmAgent: 'codex' }) })

        await expect(resolveVmAgent('user-1')).resolves.toBe('codex')
        expect(mockDoc).toHaveBeenCalledWith('users/user-1')
    })

    test('preserves Claude as the system fallback for users without a preference', async () => {
        await expect(resolveVmAgent('user-1')).resolves.toBe(SYSTEM_DEFAULT_VM_AGENT)
        await expect(getVmAgentSettings({ userId: 'user-1' })).resolves.toEqual({
            defaultAgent: null,
            effectiveDefaultAgent: 'claude',
            validAgents: ['claude', 'codex'],
        })
    })

    test('falls back to Claude when the preference cannot be read', async () => {
        mockGet.mockRejectedValueOnce(new Error('Firestore unavailable'))

        await expect(resolveVmAgent('user-1')).resolves.toBe('claude')
    })

    test('validates and persists the selected default agent', async () => {
        await expect(setDefaultVmAgent({ userId: 'user-1', agent: 'codex' })).resolves.toEqual(
            expect.objectContaining({ success: true, defaultAgent: 'codex', effectiveDefaultAgent: 'codex' })
        )
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ defaultVmAgent: 'codex', defaultVmAgentUpdatedAt: expect.any(Number) })
        )

        await expect(setDefaultVmAgent({ userId: 'user-1', agent: 'other' })).rejects.toMatchObject({
            code: 'invalid-argument',
        })
        expect(mockUpdate).toHaveBeenCalledTimes(1)
    })
})
