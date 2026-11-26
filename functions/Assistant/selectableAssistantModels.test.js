/**
 * The assistant model menu after AT-3163, and the upstream release each persisted key runs on.
 *
 * Verified against provider documentation on 2026-11-26:
 *   - developers.openai.com/api/docs/models (gpt-6.2-sol, gpt-6.1-terra, gpt-6-luna)
 *   - openrouter.ai/api/v1/models (deepseek/deepseek-v4.1-flash-1017)
 *
 * The keys stay as they were (they are persisted on assistants, chats, Gmail and calendar
 * configs), so every saved selection follows the new release without a Firestore migration.
 */
const {
    SELECTABLE_ASSISTANT_MODELS,
    getAssistantModelTokensPerGold,
    normalizeSelectableAssistantModelKey,
} = require('./selectableAssistantModels')
const { getModel, getTokensPerGold, normalizeModelKey } = require('./assistantModelRuntime')
const { assistantModelSupportsImageInput, resolveAssistantModelProvider } = require('./assistantModelRouting')
const {
    getAssistantReasoningEffortOptions,
    normalizeAssistantReasoningEffort,
} = require('./selectableAssistantReasoningEfforts')
const { mapAssistantModelToOpenAIModel: mapGmailModel } = require('../Gmail/gmailPromptClassifier')
const { mapAssistantModelToOpenAIModel: mapCalendarModel } = require('../GoogleCalendar/calendarProjectClassifier')
const { ASSISTANT_MODEL_UPSTREAM } = require('../Growth/growthCostModel')

const CURRENT_UPSTREAM = {
    MODEL_GPT6_SOL: 'gpt-6.2-sol',
    MODEL_GPT5_6_TERRA: 'gpt-6.1-terra',
    MODEL_GPT6_LUNA: 'gpt-6-luna',
    MODEL_DEEPSEEK_V4_FLASH: 'deepseek/deepseek-v4.1-flash-1017',
}

describe('assistant model menu (AT-3163)', () => {
    test('offers exactly the current release of each tier, with its label and Gold rate', () => {
        expect(
            SELECTABLE_ASSISTANT_MODELS.map(({ model, labelKey, name, tokensPerGold }) => ({
                model,
                labelKey,
                name,
                tokensPerGold,
            }))
        ).toEqual([
            { model: 'MODEL_GPT6_SOL', labelKey: 'GPT 6.2 Sol', name: 'Sol', tokensPerGold: 200 },
            // Half of Sol's list price ($1/$5 vs $2/$10), so twice Sol's tokens per Gold.
            { model: 'MODEL_GPT5_6_TERRA', labelKey: 'GPT 6.1 Terra', name: 'Terra', tokensPerGold: 400 },
            { model: 'MODEL_GPT6_LUNA', labelKey: 'GPT 6 Luna', name: 'Luna', tokensPerGold: 1000 },
            {
                model: 'MODEL_DEEPSEEK_V4_FLASH',
                labelKey: 'DeepSeek V4.1 Flash',
                name: 'DeepSeek Flash',
                tokensPerGold: 2000,
            },
        ])
    })

    test('billing uses the same rate the picker shows, for current and replaced keys', () => {
        for (const option of SELECTABLE_ASSISTANT_MODELS) {
            expect(getTokensPerGold(option.model)).toBe(option.tokensPerGold)
        }
        expect(getTokensPerGold('MODEL_GPT5_6_SOL')).toBe(200)
        expect(getTokensPerGold('MODEL_GPT5_6_LUNA')).toBe(1000)
        expect(getAssistantModelTokensPerGold('MODEL_GPT5_6_SOL')).toBe(200)
    })

    test.each(Object.entries(CURRENT_UPSTREAM))('%s runs on %s in chat and heartbeats', (key, upstream) => {
        expect(getModel(key)).toBe(upstream)
    })

    test('replaced and missing keys run on the current Sol and Luna', () => {
        expect(normalizeSelectableAssistantModelKey('MODEL_GPT5_6_SOL')).toBe('MODEL_GPT6_SOL')
        expect(normalizeSelectableAssistantModelKey('MODEL_GPT5_6_LUNA')).toBe('MODEL_GPT6_LUNA')
        expect(getModel('MODEL_GPT5_6_SOL')).toBe('gpt-6.2-sol')
        expect(getModel('MODEL_GPT5_6_LUNA')).toBe('gpt-6-luna')
        expect(normalizeModelKey(undefined)).toBe('MODEL_GPT6_SOL')
        expect(getModel(undefined)).toBe('gpt-6.2-sol')
        expect(getModel('MODEL_SOMETHING_UNKNOWN')).toBe('gpt-6.2-sol')
    })

    test.each(Object.entries(CURRENT_UPSTREAM))('%s labels Gmail and calendar on %s too', (key, upstream) => {
        expect(mapGmailModel(key)).toBe(upstream)
        expect(mapCalendarModel(key)).toBe(upstream)
    })

    test('the growth cost model prices each key at the release it runs on', () => {
        expect(ASSISTANT_MODEL_UPSTREAM).toEqual({
            MODEL_GPT6_SOL: 'gpt-6.2-sol',
            MODEL_GPT5_6_TERRA: 'gpt-6.1-terra',
            MODEL_GPT6_LUNA: 'gpt-6-luna',
            MODEL_DEEPSEEK_V4_FLASH: 'openrouter:deepseek/deepseek-v4.1-flash-1017',
        })
    })

    test('DeepSeek V4.1 Flash goes to OpenRouter and may be sent images', () => {
        expect(resolveAssistantModelProvider('MODEL_DEEPSEEK_V4_FLASH')).toMatchObject({
            provider: 'openrouter',
            model: 'deepseek/deepseek-v4.1-flash-1017',
        })
        expect(assistantModelSupportsImageInput('MODEL_DEEPSEEK_V4_FLASH')).toBe(true)
    })

    test('Sol 6.2 still rejects reasoning effort none; Terra and Luna keep it', () => {
        const values = model => getAssistantReasoningEffortOptions(model).map(option => option.value)
        expect(values('MODEL_GPT6_SOL')).not.toContain('none')
        expect(values('gpt-6.2-sol')).not.toContain('none')
        expect(normalizeAssistantReasoningEffort('none', 'MODEL_GPT6_SOL')).toBe('high')
        expect(values('MODEL_GPT5_6_TERRA')).toEqual([null, 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
        expect(values('MODEL_GPT6_LUNA')).toEqual([null, 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
    })
})
