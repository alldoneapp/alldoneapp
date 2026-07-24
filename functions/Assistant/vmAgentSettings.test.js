const mockGet = jest.fn()
const mockUpdate = jest.fn(async () => {})
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }))
const mockFirestore = jest.fn(() => ({ doc: mockDoc }))

jest.mock(
    'firebase-admin',
    () => ({
        firestore: mockFirestore,
    }),
    { virtual: true }
)

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
    SYSTEM_DEFAULT_VM_REASONING_EFFORT,
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

    test('uses Codex and medium as the defaults for users without saved preferences', async () => {
        await expect(resolveVmAgent('user-1')).resolves.toBe(SYSTEM_DEFAULT_VM_AGENT)
        expect(SYSTEM_DEFAULT_VM_AGENT).toBe('codex')
        expect(SYSTEM_DEFAULT_VM_REASONING_EFFORT).toBe('medium')
        await expect(getVmAgentSettings({ userId: 'user-1' })).resolves.toEqual({
            defaultAgent: null,
            effectiveDefaultAgent: 'codex',
            defaultReasoningEffort: null,
            effectiveDefaultReasoningEffort: 'medium',
            validAgents: ['claude', 'codex'],
            validReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        })
        await expect(resolveVmAgentSettings('user-1')).resolves.toEqual({
            agent: 'codex',
            reasoningEffort: 'medium',
        })
    })

    test('uses the system defaults when preferences cannot be read', async () => {
        mockGet.mockRejectedValueOnce(new Error('Firestore unavailable'))

        await expect(resolveVmAgent('user-1')).resolves.toBe('codex')

        mockGet.mockRejectedValueOnce(new Error('Firestore unavailable'))
        await expect(resolveVmAgentSettings('user-1')).resolves.toEqual({
            agent: 'codex',
            reasoningEffort: 'medium',
        })
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

    test('preserves an explicitly selected agent and no-default effort', async () => {
        mockGet.mockResolvedValue({
            exists: true,
            data: () => ({ defaultVmAgent: 'claude', defaultVmAgentReasoningEffort: null }),
        })

        await expect(getVmAgentSettings({ userId: 'user-1' })).resolves.toEqual(
            expect.objectContaining({
                effectiveDefaultAgent: 'claude',
                defaultReasoningEffort: null,
                effectiveDefaultReasoningEffort: null,
            })
        )
        await expect(resolveVmAgentSettings('user-1')).resolves.toEqual({
            agent: 'claude',
            reasoningEffort: null,
        })

        mockGet.mockResolvedValue({
            exists: true,
            // Before this change, selecting "No default" deleted the value but retained this marker.
            data: () => ({ defaultVmAgent: 'claude', defaultVmAgentReasoningEffortUpdatedAt: 123 }),
        })
        await expect(resolveVmAgentSettings('user-1')).resolves.toEqual({
            agent: 'claude',
            reasoningEffort: null,
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

    test('validates and persists the default reasoning effort, including an explicit null', async () => {
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
        expect(mockUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ defaultVmAgentReasoningEffort: null }))

        await expect(setDefaultVmAgentReasoningEffort({ userId: 'user-1', effort: 'minimal' })).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })
})
