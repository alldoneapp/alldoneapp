const {
    INHERIT_ASSISTANT_MODEL,
    PRE_CONFIG_TASK_MODEL_OPTIONS,
    getPreConfigTaskModelOverride,
    getPreConfigTaskModelSelection,
} = require('./preConfigTaskModel')
const { SELECTABLE_ASSISTANT_MODELS } = require('./selectableAssistantModels')

describe('pre-configured task model selection', () => {
    test('legacy copied aiModel values inherit from the assistant', () => {
        const task = { aiModel: 'MODEL_GPT5_5' }

        expect(getPreConfigTaskModelOverride(task)).toBeNull()
        expect(getPreConfigTaskModelSelection(task)).toBe(INHERIT_ASSISTANT_MODEL)
    })

    test('returns a deliberately saved task model override', () => {
        const task = { aiModelOverride: 'MODEL_GPT5_6_TERRA' }

        expect(getPreConfigTaskModelOverride(task)).toBe('MODEL_GPT5_6_TERRA')
        expect(getPreConfigTaskModelSelection(task)).toBe('MODEL_GPT5_6_TERRA')
    })

    test('empty override values inherit from the assistant', () => {
        expect(getPreConfigTaskModelOverride({ aiModelOverride: '  ' })).toBeNull()
        expect(getPreConfigTaskModelSelection({ aiModelOverride: '' })).toBe(INHERIT_ASSISTANT_MODEL)
    })

    // The invariant worth protecting is that every model picker offers the *same* set, not that the
    // set has three particular members — a model added to the shared selector must reach the
    // per-task override too, or a user can pick it for an assistant and then find it missing here.
    test('offers exactly the shared selectable models in every model picker', () => {
        const values = PRE_CONFIG_TASK_MODEL_OPTIONS.map(option => option.value)

        expect(values).toEqual(SELECTABLE_ASSISTANT_MODELS.map(option => option.model))
        expect(values).toEqual([
            'MODEL_GPT5_6_SOL',
            'MODEL_GPT5_6_TERRA',
            'MODEL_GPT5_6_LUNA',
            'MODEL_DEEPSEEK_V4_FLASH',
        ])
        expect(SELECTABLE_ASSISTANT_MODELS.map(option => option.name)).toEqual([
            'Sol',
            'Terra',
            'Luna',
            'DeepSeek Flash',
        ])
        expect(PRE_CONFIG_TASK_MODEL_OPTIONS.map(option => option.tokensPerGold)).toEqual(
            SELECTABLE_ASSISTANT_MODELS.map(option => option.tokensPerGold)
        )
    })
})
