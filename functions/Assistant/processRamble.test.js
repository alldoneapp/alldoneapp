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

const mockGetUserVocabularyTerms = jest.fn()
jest.mock('../shared/userVoiceVocabulary', () => ({
    getUserVocabularyTerms: (...args) => mockGetUserVocabularyTerms(...args),
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
    mockGetUserVocabularyTerms.mockResolvedValue({ terms: [], cacheState: 'fresh', pendingRebuild: null })
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
        expect(result).toEqual({
            text: 'cleaned text',
            transcript: 'raw transcript',
            goldCharged: 11,
            timings: expect.objectContaining({ totalMs: expect.any(Number), cleanupMs: expect.any(Number) }),
        })
        expect(mockCleanupRamble).toHaveBeenCalledWith(
            expect.objectContaining({
                transcript: 'raw transcript',
                targetKind: 'comment',
                appLanguage: 'de',
                cacheScope: 'user-1:project-1',
                // The rambler model preference lives on the user doc; cleanup must receive it.
                userData: expect.objectContaining({ language: 'de' }),
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
            timings: expect.any(Object),
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

// PT-4648: without this, there is no way to tell whether Deepgram's keyterm prompting or the LLM
// cleanup fixed a brand spelling — or whether the cleanup introduced the mirror-image error.
describe('dictation vocabulary observability', () => {
    let logSpy

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        logSpy.mockRestore()
    })

    const loggedPayload = () => logSpy.mock.calls.find(call => call[0] === '[processRamble] timing')?.[1]

    test('reports a brand the cleanup repaired, separating the two layers', async () => {
        mockTranscribeAudioBase64.mockResolvedValue({ transcript: 'add this to all done', durationSeconds: 5 })
        mockCleanupRamble.mockResolvedValue({
            text: 'Add this to Alldone.',
            totalTokens: 10,
            modelKey: 'MODEL_GPT5_6_SOL',
        })

        await callHandler()

        const payload = loggedPayload()
        // Absent from the raw transcript, present after cleanup => the LLM did the work.
        expect(payload.vocabularyTerms.Alldone).toEqual({ raw: 0, cleaned: 1 })
        expect(payload.vocabularyConfusable['all done']).toEqual({ raw: 1, cleaned: 0 })
    })

    test('reports a brand Deepgram already got right', async () => {
        mockTranscribeAudioBase64.mockResolvedValue({ transcript: 'add this to Alldone', durationSeconds: 5 })
        mockCleanupRamble.mockResolvedValue({
            text: 'Add this to Alldone.',
            totalTokens: 10,
            modelKey: 'MODEL_GPT5_6_SOL',
        })

        await callHandler()

        expect(loggedPayload().vocabularyTerms.Alldone).toEqual({ raw: 1, cleaned: 1 })
    })

    test('never logs the dictated content itself', async () => {
        mockTranscribeAudioBase64.mockResolvedValue({
            transcript: 'salary negotiation with Daniela',
            durationSeconds: 5,
        })
        mockCleanupRamble.mockResolvedValue({
            text: 'Salary negotiation with Daniela.',
            totalTokens: 10,
            modelKey: 'MODEL_GPT5_6_SOL',
        })

        await callHandler()

        const serialized = JSON.stringify(loggedPayload())
        expect(serialized).not.toContain('salary')
        expect(serialized).not.toContain('Daniela')
        // Lengths are fine — they are not content.
        expect(loggedPayload().transcriptChars).toBe('salary negotiation with Daniela'.length)
    })
})

// PT-4648: the per-user half. The load-bearing property is that BOTH layers receive the SAME final
// list — if they could disagree, the cleanup would "correct" a spelling Deepgram was told to emit.
describe('per-user dictation vocabulary', () => {
    const { PRODUCT_KEYTERMS } = require('../shared/transcriptionVocabulary')

    beforeEach(() => {
        mockGetUserVocabularyTerms.mockResolvedValue({
            terms: ['Anna Somova', 'Heyflow'],
            cacheState: 'fresh',
            pendingRebuild: null,
        })
    })

    test('sends the static glossary merged with the user terms to Deepgram', async () => {
        await callHandler()

        const [, options] = mockTranscribeAudioBase64.mock.calls[0]
        expect(options.keyterms).toEqual([...PRODUCT_KEYTERMS, 'Anna Somova', 'Heyflow'])
    })

    test('hands the cleanup the identical list, so the two layers cannot disagree', async () => {
        await callHandler()

        const [, transcribeOptions] = mockTranscribeAudioBase64.mock.calls[0]
        const cleanupArgs = mockCleanupRamble.mock.calls[0][0]
        expect(cleanupArgs.vocabularyTerms).toEqual(transcribeOptions.keyterms)
    })

    test('excludes the static glossary when asking for the user terms', async () => {
        // A term every user already gets must not consume one of this user's slots.
        await callHandler()
        expect(mockGetUserVocabularyTerms).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'user-1', excludeTerms: PRODUCT_KEYTERMS })
        )
    })

    test('still dictates when the vocabulary lookup degrades to nothing', async () => {
        // Losing the personalized boost is a bad day; losing the dictation is a broken feature.
        mockGetUserVocabularyTerms.mockResolvedValue({ terms: [], cacheState: 'unavailable', pendingRebuild: null })

        const result = await callHandler()

        expect(result.text).toBe('cleaned text')
        const [, options] = mockTranscribeAudioBase64.mock.calls[0]
        expect(options.keyterms).toEqual(PRODUCT_KEYTERMS)
    })

    test('awaits an in-flight rebuild so the cache is not left cold forever', async () => {
        // Cloud Run may freeze the container once the response returns; an un-awaited rebuild is a
        // cache that never fills, and the user would silently get the static glossary every time.
        let resolveRebuild
        const pendingRebuild = new Promise(resolve => {
            resolveRebuild = resolve
        })
        let settled = false
        pendingRebuild.then(() => {
            settled = true
        })
        mockGetUserVocabularyTerms.mockResolvedValue({ terms: ['Somova'], cacheState: 'stale', pendingRebuild })

        const pendingCall = callHandler()
        await Promise.resolve()
        resolveRebuild()
        await pendingCall

        expect(settled).toBe(true)
    })

    test('does not hang the response on a rebuild that never finishes', async () => {
        jest.useFakeTimers()
        try {
            mockGetUserVocabularyTerms.mockResolvedValue({
                terms: ['Somova'],
                cacheState: 'stale',
                pendingRebuild: new Promise(() => {}),
            })

            const pendingCall = callHandler()
            // Drain the microtask queue, then let the drain timeout fire.
            await Promise.resolve()
            await jest.advanceTimersByTimeAsync(5000)

            await expect(pendingCall).resolves.toEqual(expect.objectContaining({ text: 'cleaned text' }))
        } finally {
            jest.useRealTimers()
        }
    })

    test('logs the cache state and per-user counts without naming a single term', async () => {
        // These terms are contact names. `Somova: 1` in Cloud Logging would be a data leak through
        // a spelling hint.
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        try {
            mockTranscribeAudioBase64.mockResolvedValue({
                transcript: 'call Anna Somova about Heyflow',
                durationSeconds: 5,
            })
            mockCleanupRamble.mockResolvedValue({
                text: 'Call Anna Somova about Heyflow.',
                totalTokens: 10,
                modelKey: 'MODEL_GPT5_6_SOL',
            })

            await callHandler()

            const payload = logSpy.mock.calls.find(call => call[0] === '[processRamble] timing')?.[1]
            expect(payload.vocabularyCacheState).toBe('fresh')
            expect(payload.vocabularyDynamicCount).toBe(2)
            expect(payload.vocabularyDynamic).toEqual({ termCount: 2, raw: 2, cleaned: 2, matchedTerms: 2 })
            expect(JSON.stringify(payload)).not.toContain('Somova')
            expect(JSON.stringify(payload)).not.toContain('Heyflow')
        } finally {
            logSpy.mockRestore()
        }
    })
})
