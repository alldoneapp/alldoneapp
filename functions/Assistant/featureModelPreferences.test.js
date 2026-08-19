const {
    FEATURE_MODEL_FEATURES,
    getFeatureModelOptionInfo,
    isSelectableAssistantModelKey,
    isValidFeatureModelChoice,
    resolveFeatureModelKey,
} = require('./featureModelPreferences')

describe('resolveFeatureModelKey', () => {
    test('every feature resolves to its default (Luna across the board) with no stored preference', () => {
        expect(resolveFeatureModelKey('rambler', {})).toBe('MODEL_GPT5_6_LUNA')
        expect(resolveFeatureModelKey('emailDraftReply', {})).toBe('MODEL_GPT5_6_LUNA')
        expect(resolveFeatureModelKey('emailTaskSummary', {})).toBe('MODEL_GPT5_6_LUNA')
        expect(resolveFeatureModelKey('taskGoalRouting', {})).toBe('MODEL_GPT5_6_LUNA')
        expect(resolveFeatureModelKey('rambler', null)).toBe('MODEL_GPT5_6_LUNA')
    })

    test('a stored selectable choice wins', () => {
        const userData = { featureModelPreferences: { rambler: 'MODEL_GPT5_6_SOL' } }
        expect(resolveFeatureModelKey('rambler', userData)).toBe('MODEL_GPT5_6_SOL')
    })

    test('an invalid or retired stored value fails safe to the default', () => {
        expect(resolveFeatureModelKey('rambler', { featureModelPreferences: { rambler: 'MODEL_BOGUS' } })).toBe(
            'MODEL_GPT5_6_LUNA'
        )
        // Non-selectable keys (the retired mini/nano defaults) are not valid picker choices.
        expect(
            resolveFeatureModelKey('emailDraftReply', {
                featureModelPreferences: { emailDraftReply: 'MODEL_GPT5_4_NANO' },
            })
        ).toBe('MODEL_GPT5_6_LUNA')
    })

    test('OpenRouter models are rejected for Responses-API-only features but allowed elsewhere', () => {
        const userData = {
            featureModelPreferences: {
                taskGoalRouting: 'MODEL_DEEPSEEK_V4_FLASH',
                rambler: 'MODEL_DEEPSEEK_V4_FLASH',
            },
        }
        expect(resolveFeatureModelKey('taskGoalRouting', userData)).toBe('MODEL_GPT5_6_LUNA')
        expect(resolveFeatureModelKey('rambler', userData)).toBe('MODEL_DEEPSEEK_V4_FLASH')
    })

    test('an unknown feature key throws — programmer error, not a data state', () => {
        expect(() => resolveFeatureModelKey('nope', {})).toThrow('Unknown feature model key')
    })
})

describe('isValidFeatureModelChoice', () => {
    test('accepts selectable models and rejects unknown keys and unknown features', () => {
        expect(isValidFeatureModelChoice('rambler', 'MODEL_GPT5_6_TERRA')).toBe(true)
        expect(isValidFeatureModelChoice('rambler', 'MODEL_SONAR_PRO')).toBe(false)
        expect(isValidFeatureModelChoice('rambler', '')).toBe(false)
        expect(isValidFeatureModelChoice('nope', 'MODEL_GPT5_6_SOL')).toBe(false)
    })
})

describe('getFeatureModelOptionInfo', () => {
    test('covers the selectable models and nothing else', () => {
        expect(getFeatureModelOptionInfo('MODEL_GPT5_6_SOL')).toEqual({ name: 'Sol', tokensPerGold: 100 })
        expect(getFeatureModelOptionInfo('MODEL_GPT5_6_LUNA')).toEqual({ name: 'Luna', tokensPerGold: 500 })
        expect(getFeatureModelOptionInfo('MODEL_GPT5_4_MINI')).toBeNull()
        expect(getFeatureModelOptionInfo('MODEL_BOGUS')).toBeNull()
    })

    test('every feature default has display info — the Settings picker renders "Use default (X)" from it', () => {
        for (const feature of Object.values(FEATURE_MODEL_FEATURES)) {
            expect(getFeatureModelOptionInfo(feature.defaultModelKey)).not.toBeNull()
        }
    })

    test('every feature default is either selectable or has explicit non-selectable info', () => {
        for (const [featureKey, feature] of Object.entries(FEATURE_MODEL_FEATURES)) {
            const selectable = isSelectableAssistantModelKey(feature.defaultModelKey)
            const info = getFeatureModelOptionInfo(feature.defaultModelKey)
            expect(selectable || info !== null).toBe(true)
            // And the default itself must resolve — a feature whose default failed validation
            // would loop back to itself anyway, but keep the invariant visible.
            expect(resolveFeatureModelKey(featureKey, {})).toBe(feature.defaultModelKey)
        }
    })
})
