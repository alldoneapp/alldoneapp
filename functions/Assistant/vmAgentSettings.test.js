const mockGet = jest.fn()
const mockUpdate = jest.fn(async () => {})
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }))
const mockDelete = jest.fn(() => ({ __op: 'delete' }))
const mockFirestore = jest.fn(() => ({ doc: mockDoc }))
mockFirestore.FieldValue = { delete: mockDelete }

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
    SYSTEM_DEFAULT_VM_AGENT,
    getVmAgentSettings,
    resolveVmAgent,
    resolveVmAgentSettings,
    setDefaultVmAgent,
    setDefaultVmAgentReasoningEffort,
} = require('./vmAgentSettings')

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
            defaultReasoningEffort: null,
            validAgents: ['claude', 'codex'],
            validReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        })
    })

    test('falls back to Claude when the preference cannot be read', async () => {
        mockGet.mockRejectedValueOnce(new Error('Firestore unavailable'))

        await expect(resolveVmAgent('user-1')).resolves.toBe('claude')
    })

    test('resolves explicit values before stored user defaults', async () => {
        await expect(resolveVmAgentSettings('user-1', 'claude', 'low')).resolves.toEqual({
            agent: 'claude',
            reasoningEffort: 'low',
        })
        expect(mockGet).not.toHaveBeenCalled()

        mockGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ defaultVmAgent: 'codex', defaultVmAgentReasoningEffort: 'xhigh' }),
        })
        await expect(resolveVmAgentSettings('user-1')).resolves.toEqual({
            agent: 'codex',
            reasoningEffort: 'xhigh',
        })
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

    test('validates, persists and unsets the default reasoning effort', async () => {
        await expect(setDefaultVmAgentReasoningEffort({ userId: 'user-1', effort: 'high' })).resolves.toEqual(
            expect.objectContaining({ success: true, defaultReasoningEffort: 'high' })
        )
        expect(mockUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({
                defaultVmAgentReasoningEffort: 'high',
                defaultVmAgentReasoningEffortUpdatedAt: expect.any(Number),
            })
        )

        await expect(setDefaultVmAgentReasoningEffort({ userId: 'user-1', effort: null })).resolves.toEqual(
            expect.objectContaining({ success: true, defaultReasoningEffort: null })
        )
        expect(mockDelete).toHaveBeenCalledTimes(1)
        expect(mockUpdate).toHaveBeenLastCalledWith(
            expect.objectContaining({ defaultVmAgentReasoningEffort: { __op: 'delete' } })
        )

        await expect(setDefaultVmAgentReasoningEffort({ userId: 'user-1', effort: 'minimal' })).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })
})
