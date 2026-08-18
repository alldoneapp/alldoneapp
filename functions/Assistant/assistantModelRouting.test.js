const {
    MODEL_DEEPSEEK_V4_FLASH,
    OPENROUTER_ASSISTANT_MODEL_IDS,
    PROVIDER_OPENAI,
    PROVIDER_OPENROUTER,
    PROVIDER_PERPLEXITY,
    isOpenRouterAssistantModel,
    isPerplexityAssistantModel,
    getOpenRouterAssistantModelId,
    assistantModelSupportsImageInput,
    resolveAssistantModelProvider,
} = require('./assistantModelRouting')
const { SELECTABLE_ASSISTANT_MODELS } = require('./selectableAssistantModels')

describe('assistantModelRouting', () => {
    test('pins DeepSeek Flash to the dated OpenRouter release rather than a floating alias', () => {
        // The floating `~deepseek/deepseek-v4-flash-latest` alias would swap the model under live
        // assistants and labeling configs with no review. A dated id makes that an explicit change.
        expect(OPENROUTER_ASSISTANT_MODEL_IDS[MODEL_DEEPSEEK_V4_FLASH]).toBe('deepseek/deepseek-v4-flash-0731')
        expect(getOpenRouterAssistantModelId(MODEL_DEEPSEEK_V4_FLASH)).toBe('deepseek/deepseek-v4-flash-0731')
    })

    test('routes the DeepSeek key to OpenRouter with a ready-to-send model id', () => {
        expect(resolveAssistantModelProvider(MODEL_DEEPSEEK_V4_FLASH)).toEqual({
            provider: PROVIDER_OPENROUTER,
            model: 'deepseek/deepseek-v4-flash-0731',
            modelKey: MODEL_DEEPSEEK_V4_FLASH,
        })
        expect(isOpenRouterAssistantModel(MODEL_DEEPSEEK_V4_FLASH)).toBe(true)
    })

    test('leaves OpenAI and Perplexity keys on their existing providers', () => {
        // `model: null` is the contract that says "use your own key→id mapper" — duplicating
        // `getModel` here is the drift this module exists to prevent.
        expect(resolveAssistantModelProvider('MODEL_GPT5_6_SOL')).toEqual({
            provider: PROVIDER_OPENAI,
            model: null,
            modelKey: 'MODEL_GPT5_6_SOL',
        })
        expect(resolveAssistantModelProvider('MODEL_SONAR_PRO')).toEqual({
            provider: PROVIDER_PERPLEXITY,
            model: null,
            modelKey: 'MODEL_SONAR_PRO',
        })
        expect(isPerplexityAssistantModel('MODEL_SONAR_DEEP_RESEARCH')).toBe(true)
        expect(isOpenRouterAssistantModel('MODEL_GPT5_6_LUNA')).toBe(false)
    })

    test('an unknown or empty key falls back to OpenAI instead of failing the run', () => {
        // Pre-AT-2238 behaviour: it then flows into `getModel`'s own `gpt-5.6-sol` fallback.
        expect(resolveAssistantModelProvider('MODEL_SOMETHING_NEW').provider).toBe(PROVIDER_OPENAI)
        expect(resolveAssistantModelProvider('').provider).toBe(PROVIDER_OPENAI)
        expect(resolveAssistantModelProvider(undefined).provider).toBe(PROVIDER_OPENAI)
        expect(resolveAssistantModelProvider(null).provider).toBe(PROVIDER_OPENAI)
    })

    test('asking for a non-OpenRouter model id returns null, never a plausible wrong model', () => {
        expect(getOpenRouterAssistantModelId('MODEL_GPT5_6_SOL')).toBeNull()
        expect(getOpenRouterAssistantModelId('nonsense')).toBeNull()
        expect(getOpenRouterAssistantModelId(undefined)).toBeNull()
    })

    test('tolerates surrounding whitespace on a stored key', () => {
        // Config docs are written by several call sites; a stray space must not silently reroute a
        // model to the OpenAI fallback and bill the user for a model they did not select.
        expect(resolveAssistantModelProvider(`  ${MODEL_DEEPSEEK_V4_FLASH}  `).provider).toBe(PROVIDER_OPENROUTER)
    })

    test('every OpenRouter-routed key is actually offered in the product model list', () => {
        const selectableKeys = SELECTABLE_ASSISTANT_MODELS.map(option => option.model)
        Object.keys(OPENROUTER_ASSISTANT_MODEL_IDS).forEach(key => {
            expect(selectableKeys).toContain(key)
        })
    })

    test('reports DeepSeek Flash as unable to read images', () => {
        // The pinned release advertises `input_modalities: ['text']`. Answering `true` here would
        // send an image_url part and fail the whole request; the transport strips it instead.
        expect(assistantModelSupportsImageInput(MODEL_DEEPSEEK_V4_FLASH)).toBe(false)
    })

    test('treats an unlisted OpenRouter model as text-only and OpenAI models as multimodal', () => {
        // Fail safe: a stripped image degrades to a note the model can explain, while an image sent
        // to a text-only model takes the entire request down.
        expect(assistantModelSupportsImageInput('MODEL_SONAR_PRO')).toBe(false)
        expect(assistantModelSupportsImageInput('MODEL_GPT5_6_LUNA')).toBe(true)
        expect(assistantModelSupportsImageInput('MODEL_GPT5_6_SOL')).toBe(true)
    })

    test('every OpenRouter id is a legal vendor/model string', () => {
        // The id is interpolated into request bodies and logs; keep it to the same shape the VM
        // harness enforces so the two systems cannot disagree about what a valid id looks like.
        Object.values(OPENROUTER_ASSISTANT_MODEL_IDS).forEach(id => {
            expect(id).toMatch(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i)
        })
    })
})
