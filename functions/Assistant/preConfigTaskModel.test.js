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

    test('only offers Sol, Terra, and Luna in every model picker', () => {
        const values = PRE_CONFIG_TASK_MODEL_OPTIONS.map(option => option.value)

        expect(values).toEqual(['MODEL_GPT5_6_SOL', 'MODEL_GPT5_6_TERRA', 'MODEL_GPT5_6_LUNA'])
        expect(SELECTABLE_ASSISTANT_MODELS.map(option => option.name)).toEqual(['Sol', 'Terra', 'Luna'])
    })
})
