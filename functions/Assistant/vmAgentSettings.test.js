const mockGet = jest.fn()
const mockUpdate = jest.fn(async () => {})
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }))
const mockFirestore = jest.fn(() => ({ doc: mockDoc }))

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

// The catalog module is exercised in vmAgentModelCatalog.test.js; here it is stubbed so the
// settings tests never touch a provider or the cache doc.
const MOCK_CATALOGS = {
    claude: {
        families: [
            { id: 'opus', label: 'Opus', resolvedModel: 'opus', isAlias: true },
            { id: 'sonnet', label: 'Sonnet', resolvedModel: 'sonnet', isAlias: true },
        ],
        fetchedAt: 1,
        source: 'live',
    },
    codex: {
        families: [
            { id: 'sol', label: 'Sol', resolvedModel: 'gpt-5.6-sol', isAlias: false },
            { id: 'terra', label: 'Terra', resolvedModel: 'gpt-5.6-terra', isAlias: false },
        ],
        fetchedAt: 1,
        source: 'live',
    },
}

jest.mock('./vmAgentModelCatalog', () => {
    const actual = jest.requireActual('./vmAgentModelCatalog')
    return {
        ...actual,
        getAllModelCatalogs: jest.fn(async () => MOCK_CATALOGS),
        getModelCatalog: jest.fn(async provider => MOCK_CATALOGS[provider]),
    }
})

const { getModelCatalog } = require('./vmAgentModelCatalog')

const {
    SYSTEM_DEFAULT_VM_AGENT,
    SYSTEM_DEFAULT_VM_REASONING_EFFORT,
    getVmAgentSettings,
    resolveVmAgent,
    resolveVmAgentSettings,
    setDefaultVmAgent,
    setDefaultVmAgentReasoningEffort,
    setDefaultVmAgentModel,
    resolveVmAgentModelFamily,
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
            defaultApprovalPolicy: null,
            effectiveDefaultApprovalPolicy: 'balanced',
            defaultModelFamilies: { claude: null, codex: null },
            modelCatalogs: MOCK_CATALOGS,
            validAgents: ['claude', 'codex'],
            validReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
            validApprovalPolicies: ['strict', 'balanced', 'permissive'],
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

    describe('default model family (AT-2221)', () => {
        test('reads a per-agent family map and ignores malformed entries', async () => {
            mockGet.mockResolvedValue({
                exists: true,
                data: () => ({ defaultVmAgentModel: { claude: 'sonnet', codex: 'gpt-5.6-sol' } }),
            })

            await expect(resolveVmAgentModelFamily('user-1', 'claude')).resolves.toBe('sonnet')
            // A concrete id is not a family id — it must not be honoured as one.
            await expect(resolveVmAgentModelFamily('user-1', 'codex')).resolves.toBeNull()
        })

        test('returns no preference for users who never chose one', async () => {
            await expect(resolveVmAgentModelFamily('user-1', 'claude')).resolves.toBeNull()
        })

        test('degrades to no preference when the settings read fails', async () => {
            mockGet.mockRejectedValueOnce(new Error('Firestore unavailable'))
            await expect(resolveVmAgentModelFamily('user-1', 'claude')).resolves.toBeNull()
        })

        test('persists one agent via a dotted path so the other agent keeps its choice', async () => {
            await expect(
                setDefaultVmAgentModel({ userId: 'user-1', agent: 'codex', family: 'terra' })
            ).resolves.toEqual(expect.objectContaining({ success: true, agent: 'codex', family: 'terra' }))
            expect(mockUpdate).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    'defaultVmAgentModel.codex': 'terra',
                    defaultVmAgentModelUpdatedAt: expect.any(Number),
                })
            )
            // Never a whole-object write — that would clobber the sibling agent.
            expect(mockUpdate.mock.calls.at(-1)[0]).not.toHaveProperty('defaultVmAgentModel')
        })

        test('clears the default with an explicit null', async () => {
            await expect(setDefaultVmAgentModel({ userId: 'user-1', agent: 'claude', family: null })).resolves.toEqual(
                expect.objectContaining({ success: true, family: null })
            )
            expect(mockUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ 'defaultVmAgentModel.claude': null }))
        })

        test('rejects an unknown agent, a malformed family, and a family the provider does not offer', async () => {
            await expect(
                setDefaultVmAgentModel({ userId: 'user-1', agent: 'gemini', family: 'opus' })
            ).rejects.toMatchObject({ code: 'invalid-argument' })

            await expect(
                setDefaultVmAgentModel({ userId: 'user-1', agent: 'claude', family: '../etc/passwd' })
            ).rejects.toMatchObject({ code: 'invalid-argument' })

            await expect(
                setDefaultVmAgentModel({ userId: 'user-1', agent: 'claude', family: 'haiku' })
            ).rejects.toMatchObject({ code: 'invalid-argument' })
            expect(mockUpdate).not.toHaveBeenCalled()
        })

        test('accepts any well-formed family when the catalog is degraded, rather than blocking the save', async () => {
            getModelCatalog.mockResolvedValueOnce({ families: [], source: 'fallback', fetchedAt: 0 })

            await expect(
                setDefaultVmAgentModel({ userId: 'user-1', agent: 'claude', family: 'mythos' })
            ).resolves.toEqual(expect.objectContaining({ success: true, family: 'mythos' }))
        })

        test('saves even when the catalog lookup itself throws', async () => {
            getModelCatalog.mockRejectedValueOnce(new Error('provider down'))

            await expect(setDefaultVmAgentModel({ userId: 'user-1', agent: 'codex', family: 'luna' })).resolves.toEqual(
                expect.objectContaining({ success: true, family: 'luna' })
            )
        })

        test('requires authentication', async () => {
            await expect(setDefaultVmAgentModel({ agent: 'claude', family: 'opus' })).rejects.toMatchObject({
                code: 'unauthenticated',
            })
        })
    })
})
