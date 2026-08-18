/**
 * Contract tests for the rambler callable: validation, access, the gold pre-check, billing shape
 * (single 'rambler' transaction, Math.max(1, …) on duration + tokens at the model's rate), the
 * empty-transcript refusal (no charge), and the raw-transcript fallback when cleanup fails.
 */

const mockUserGet = jest.fn()
const mockDoc = jest.fn(() => ({ get: mockUserGet }))
jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({ doc: mockDoc })),
}))

jest.mock(
    'firebase-functions/v2/https',
    () => ({
        onCall: (options, handler) => handler,
        HttpsError: class HttpsError extends Error {
            constructor(code, message) {
                super(message)
                this.code = code
            }
        },
    }),
    { virtual: true }
)

const mockTranscribeAudioBase64 = jest.fn()
jest.mock('../Notes/deepgramTranscribe', () => ({
    transcribeAudioBase64: (...args) => mockTranscribeAudioBase64(...args),
}))

const mockGetAccessibleProjectIds = jest.fn()
const mockGetAssistantForChat = jest.fn()
const mockGetProjectContext = jest.fn()
const mockGetUserContext = jest.fn()
const mockGetTokensPerGold = jest.fn()
jest.mock('./assistantHelper', () => ({
    getAccessibleProjectIdsFromUserData: (...args) => mockGetAccessibleProjectIds(...args),
    getAssistantForChat: (...args) => mockGetAssistantForChat(...args),
    getProjectDescriptionContextMessage: (...args) => mockGetProjectContext(...args),
    getUserDescriptionContextMessage: (...args) => mockGetUserContext(...args),
    getTokensPerGold: (...args) => mockGetTokensPerGold(...args),
}))

const mockGetDefaultAssistantIdForProject = jest.fn()
jest.mock('../shared/projectRoutingCommentHelper', () => ({
    getDefaultAssistantIdForProject: (...args) => mockGetDefaultAssistantIdForProject(...args),
}))

const mockCleanupRamble = jest.fn()
jest.mock('./ramblerCleanup', () => ({
    cleanupRamble: (...args) => mockCleanupRamble(...args),
}))

const mockDeductGold = jest.fn()
jest.mock('../Gold/goldHelper', () => ({
    deductGold: (...args) => mockDeductGold(...args),
}))

const {
    processRambleSecondGen,
    calculateRambleGoldCost,
    normalizeTargetKind,
    MAX_AUDIO_BASE64_LENGTH,
} = require('./processRamble')

const AUTH = { uid: 'user-1' }
const BASE_DATA = { projectId: 'project-1', audio: 'data:audio/webm;base64,AAAA', targetKind: 'comment' }

const callHandler = (data = BASE_DATA, auth = AUTH) => processRambleSecondGen({ data, auth })

beforeEach(() => {
    jest.clearAllMocks()
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ gold: 50, language: 'de' }) })
    mockGetAccessibleProjectIds.mockReturnValue(['project-1'])
    mockGetDefaultAssistantIdForProject.mockResolvedValue('assistant-1')
    mockGetAssistantForChat.mockResolvedValue({ uid: 'assistant-1', model: 'MODEL_GPT5_6_SOL' })
    mockGetProjectContext.mockResolvedValue('project context')
    mockGetUserContext.mockResolvedValue('user context')
    mockTranscribeAudioBase64.mockResolvedValue({ transcript: 'raw transcript', durationSeconds: 60 })
    mockCleanupRamble.mockResolvedValue({ text: 'cleaned text', totalTokens: 1000, modelKey: 'MODEL_GPT5_6_SOL' })
    mockGetTokensPerGold.mockReturnValue(100)
    mockDeductGold.mockResolvedValue({ success: true })
})

describe('processRambleSecondGen', () => {
    test('happy path bills one rambler transaction at duration + token cost and returns the cleaned text', async () => {
        const result = await callHandler()

        // 60s * 0.02 = 1.2 gold transcription + 1000 tokens / 100 = 10 gold cleanup → round(11.2) = 11
        expect(mockDeductGold).toHaveBeenCalledTimes(1)
        expect(mockDeductGold).toHaveBeenCalledWith('user-1', 11, {
            source: 'rambler',
            channel: 'comment',
            projectId: 'project-1',
        })
        expect(result).toEqual({ text: 'cleaned text', transcript: 'raw transcript', goldCharged: 11 })
        expect(mockCleanupRamble).toHaveBeenCalledWith(
            expect.objectContaining({
                transcript: 'raw transcript',
                targetKind: 'comment',
                appLanguage: 'de',
                cacheScope: 'user-1:project-1',
            })
        )
    })

    test('rejects without auth', async () => {
        await expect(callHandler(BASE_DATA, null)).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('rejects a project the user cannot access before any API spend', async () => {
        mockGetAccessibleProjectIds.mockReturnValue(['other-project'])
        await expect(callHandler()).rejects.toMatchObject({ code: 'permission-denied' })
        expect(mockTranscribeAudioBase64).not.toHaveBeenCalled()
        expect(mockDeductGold).not.toHaveBeenCalled()
    })

    test('rejects missing audio and missing projectId', async () => {
        await expect(callHandler({ projectId: 'project-1' })).rejects.toMatchObject({ code: 'invalid-argument' })
        await expect(callHandler({ audio: 'data:...' })).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    test('rejects an oversized payload before transcribing', async () => {
        const audio = 'a'.repeat(MAX_AUDIO_BASE64_LENGTH + 1)
        await expect(callHandler({ ...BASE_DATA, audio })).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(mockTranscribeAudioBase64).not.toHaveBeenCalled()
    })

    test('gold pre-check rejects an empty account before any API spend', async () => {
        mockUserGet.mockResolvedValue({ exists: true, data: () => ({ gold: 0 }) })
        await expect(callHandler()).rejects.toMatchObject({ code: 'resource-exhausted' })
        expect(mockTranscribeAudioBase64).not.toHaveBeenCalled()
        expect(mockCleanupRamble).not.toHaveBeenCalled()
    })

    test('a legacy user doc without a gold field is not blocked by the pre-check', async () => {
        mockUserGet.mockResolvedValue({ exists: true, data: () => ({}) })
        await expect(callHandler()).resolves.toBeDefined()
    })

    test('empty transcript fails with EMPTY_TRANSCRIPT and charges nothing', async () => {
        mockTranscribeAudioBase64.mockResolvedValue({ transcript: '', durationSeconds: 12 })
        await expect(callHandler()).rejects.toMatchObject({
            code: 'failed-precondition',
            message: 'EMPTY_TRANSCRIPT',
        })
        expect(mockDeductGold).not.toHaveBeenCalled()
    })

    test('cleanup failure falls back to the raw transcript and bills only transcription', async () => {
        mockCleanupRamble.mockRejectedValue(new Error('llm down'))
        const result = await callHandler()

        expect(result).toEqual({
            text: 'raw transcript',
            transcript: 'raw transcript',
            goldCharged: 1, // max(1, round(60 * 0.02)) with zero cleanup tokens
            cleanupFailed: true,
        })
        expect(mockDeductGold).toHaveBeenCalledWith('user-1', 1, expect.objectContaining({ source: 'rambler' }))
    })

    test('failed deduct surfaces as resource-exhausted', async () => {
        mockDeductGold.mockResolvedValue({ success: false, message: 'Insufficient balance' })
        await expect(callHandler()).rejects.toMatchObject({ code: 'resource-exhausted' })
    })

    test('an unknown targetKind normalizes to generic for both prompt and billing channel', async () => {
        await callHandler({ ...BASE_DATA, targetKind: 'bogus' })
        expect(mockCleanupRamble).toHaveBeenCalledWith(expect.objectContaining({ targetKind: 'generic' }))
        expect(mockDeductGold).toHaveBeenCalledWith('user-1', expect.any(Number), {
            source: 'rambler',
            channel: 'generic',
            projectId: 'project-1',
        })
    })

    test('transcription errors map to internal', async () => {
        mockTranscribeAudioBase64.mockRejectedValue(new Error('deepgram down'))
        await expect(callHandler()).rejects.toMatchObject({ code: 'internal' })
        expect(mockDeductGold).not.toHaveBeenCalled()
    })

    test('a context-loading crash degrades to an uncontextualized cleanup instead of failing the ramble', async () => {
        // Synchronous throw — the shape of the missing-export production incident, which the
        // per-call .catch() handlers cannot intercept.
        mockGetAssistantForChat.mockImplementation(() => {
            throw new TypeError('getAssistantForChat is not a function')
        })

        const result = await callHandler()

        expect(result.text).toBe('cleaned text')
        expect(mockCleanupRamble).toHaveBeenCalledWith(
            expect.objectContaining({ assistant: null, projectContext: '', userContext: '' })
        )
    })
})

describe('calculateRambleGoldCost', () => {
    test('charges at least 1 gold even for tiny rambles', () => {
        mockGetTokensPerGold.mockReturnValue(100)
        expect(calculateRambleGoldCost({ durationSeconds: 3, totalTokens: 20, modelKey: 'MODEL_GPT5_6_SOL' })).toBe(1)
    })

    test('bills tokens at the executing model rate', () => {
        mockGetTokensPerGold.mockReturnValue(2000)
        // 120s * 0.02 = 2.4 + 10000/2000 = 5 → round(7.4) = 7
        expect(
            calculateRambleGoldCost({ durationSeconds: 120, totalTokens: 10000, modelKey: 'MODEL_DEEPSEEK_V4_FLASH' })
        ).toBe(7)
        expect(mockGetTokensPerGold).toHaveBeenCalledWith('MODEL_DEEPSEEK_V4_FLASH')
    })

    test('an unknown model rate falls back to the Sol baseline instead of producing NaN or 0', () => {
        mockGetTokensPerGold.mockReturnValue(undefined)
        // 0s + 500 tokens / 100 fallback = 5
        expect(calculateRambleGoldCost({ durationSeconds: 0, totalTokens: 500, modelKey: null })).toBe(5)
    })
})

describe('assistantHelper exports used by the rambler', () => {
    // The first production failure was exactly this: getUserDescriptionContextMessage existed in
    // assistantHelper but was missing from its module.exports, and the wholesale jest mock above
    // hid it. Check the REAL sources: every name the rambler modules destructure from
    // assistantHelper must appear in its module.exports block.
    test('every destructured assistantHelper function is actually exported', () => {
        const fs = require('fs')
        const path = require('path')
        const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')

        const exportsBlock = read('assistantHelper.js').match(/module\.exports = \{([\s\S]*?)\n\}/)[1]
        const ramblerSources = ['processRamble.js', 'ramblerCleanup.js'].map(read).join('\n')

        const destructured = new Set()
        const requirePattern = /\{([^{}]+)\}\s*=\s*require\('\.\/assistantHelper'\)/g
        let match
        while ((match = requirePattern.exec(ramblerSources))) {
            match[1]
                .split(',')
                .map(name => name.trim())
                .filter(Boolean)
                .forEach(name => destructured.add(name))
        }

        expect(destructured.size).toBeGreaterThan(0)
        for (const name of destructured) {
            expect(exportsBlock).toMatch(new RegExp(`\\b${name}\\b`))
        }
    })
})

describe('normalizeTargetKind', () => {
    test('keeps valid kinds and normalizes everything else to generic', () => {
        expect(normalizeTargetKind('title')).toBe('title')
        expect(normalizeTargetKind('note')).toBe('note')
        expect(normalizeTargetKind('anything')).toBe('generic')
        expect(normalizeTargetKind(undefined)).toBe('generic')
    })
})
