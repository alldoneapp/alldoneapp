const openRouterClients = []

jest.mock('./openRouterChatClient', () => ({
    getOpenRouterClient: jest.fn(apiKey => {
        const client = { kind: 'openrouter', apiKey }
        openRouterClients.push(client)
        return client
    }),
}))

// `classifierModelClient` requires `assistantHelper` lazily and only on the OpenAI branch. Mocking
// it keeps this suite from pulling a 13k-line module (and firebase-admin) in behind it, which is
// exactly the reason the real require is lazy.
jest.mock('./assistantHelper', () => ({
    getOpenAIClient: jest.fn(apiKey => ({ kind: 'openai', apiKey })),
}))

const { resolveClassifierClient } = require('./classifierModelClient')
const { getOpenRouterClient } = require('./openRouterChatClient')
const { getOpenAIClient } = require('./assistantHelper')

const KEYS = { openAiKey: 'sk-openai', openRouterKey: 'sk-openrouter' }

describe('resolveClassifierClient', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        openRouterClients.length = 0
    })

    test('sends a DeepSeek labeling model to OpenRouter with its bare upstream id', () => {
        const resolved = resolveClassifierClient('MODEL_DEEPSEEK_V4_FLASH', KEYS)

        expect(resolved).toEqual({
            client: { kind: 'openrouter', apiKey: 'sk-openrouter' },
            model: 'deepseek/deepseek-v4-flash-0731',
            isOpenRouter: true,
        })
        expect(getOpenRouterClient).toHaveBeenCalledWith('sk-openrouter')
        expect(getOpenAIClient).not.toHaveBeenCalled()
    })

    test('keeps every OpenAI labeling model on the OpenAI client', () => {
        // `model: null` is the contract meaning "use your own key→id mapper"; the classifiers keep
        // theirs, and this module deliberately does not duplicate it.
        const resolved = resolveClassifierClient('MODEL_GPT5_6_LUNA', KEYS)

        expect(resolved).toEqual({ client: { kind: 'openai', apiKey: 'sk-openai' }, model: null, isOpenRouter: false })
        expect(getOpenAIClient).toHaveBeenCalledWith('sk-openai')
        expect(getOpenRouterClient).not.toHaveBeenCalled()
    })

    test('an unknown stored model key stays on OpenAI, preserving pre-existing behaviour', () => {
        expect(resolveClassifierClient('MODEL_SOMETHING_ELSE', KEYS).isOpenRouter).toBe(false)
        expect(resolveClassifierClient(undefined, KEYS).isOpenRouter).toBe(false)
    })

    test('fails loudly when an OpenRouter model is configured without a key', () => {
        // Failing closed matters here: silently falling back to OpenAI would run the user's
        // labeling on a model they did not pick and bill it at that model's rate.
        expect(() => resolveClassifierClient('MODEL_DEEPSEEK_V4_FLASH', { openAiKey: 'sk-openai' })).toThrow(
            /OPENROUTER_API_KEY is not configured/
        )
    })

    test('the two passes of a classifier can resolve to different providers', () => {
        // A DeepSeek first pass with the default OpenAI auditor is the normal configuration, and
        // reusing one client for both would send one of them to the wrong upstream.
        const first = resolveClassifierClient('MODEL_DEEPSEEK_V4_FLASH', KEYS)
        const audit = resolveClassifierClient('MODEL_GPT5_6_TERRA', KEYS)

        expect(first.isOpenRouter).toBe(true)
        expect(audit.isOpenRouter).toBe(false)
        expect(first.client).not.toBe(audit.client)
    })
})
