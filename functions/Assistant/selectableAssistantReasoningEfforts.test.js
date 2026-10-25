const {
    SELECTABLE_ASSISTANT_REASONING_EFFORTS,
    VALID_ASSISTANT_REASONING_EFFORTS,
    isValidAssistantReasoningEffort,
    normalizeAssistantReasoningEffort,
    resolveAssistantReasoningEffort,
    getAssistantReasoningEffortLabelKey,
    getAssistantReasoningEffortOptions,
} = require('./selectableAssistantReasoningEfforts')

describe('selectable assistant reasoning efforts', () => {
    test.each(['MODEL_GPT6_SOL', 'MODEL_GPT5_6_SOL', 'gpt-6-sol', 'gpt-6.1-sol'])(
        '%s upgrades disabled reasoning to high while preserving other selections',
        model => {
            expect(normalizeAssistantReasoningEffort('none', model)).toBe('high')
            expect(normalizeAssistantReasoningEffort('low', model)).toBe('low')
            expect(normalizeAssistantReasoningEffort(null, model)).toBeNull()
            expect(getAssistantReasoningEffortOptions(model).map(option => option.value)).not.toContain('none')
        }
    )

    test('other models retain their none setting and option', () => {
        expect(normalizeAssistantReasoningEffort('none', 'MODEL_GPT5_6_TERRA')).toBe('none')
        expect(getAssistantReasoningEffortOptions('MODEL_GPT5_6_TERRA').map(option => option.value)).toContain('none')
    })
    test('defines the complete ordered product and API value set', () => {
        expect(SELECTABLE_ASSISTANT_REASONING_EFFORTS).toEqual([
            { value: null, labelKey: 'Model default' },
            { value: 'none', labelKey: 'None' },
            { value: 'low', labelKey: 'Low' },
            { value: 'medium', labelKey: 'Medium' },
            { value: 'high', labelKey: 'High' },
            { value: 'xhigh', labelKey: 'XHigh' },
            { value: 'max', labelKey: 'Max' },
        ])
        expect(VALID_ASSISTANT_REASONING_EFFORTS).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    })

    test.each(VALID_ASSISTANT_REASONING_EFFORTS)('accepts and preserves %s', effort => {
        expect(isValidAssistantReasoningEffort(effort)).toBe(true)
        expect(normalizeAssistantReasoningEffort(effort)).toBe(effort)
    })

    test('normalizes model default and unsupported values to null', () => {
        expect(normalizeAssistantReasoningEffort(null)).toBeNull()
        expect(normalizeAssistantReasoningEffort(undefined)).toBeNull()
        expect(normalizeAssistantReasoningEffort('minimal')).toBeNull()
    })

    test('preserves an explicit model default instead of falling back to the assistant effort', () => {
        expect(resolveAssistantReasoningEffort({ reasoningEffort: null }, 'high')).toBeNull()
        expect(resolveAssistantReasoningEffort({}, 'high')).toBe('high')
    })

    test('returns exact UI labels, including XHigh and Max', () => {
        expect(getAssistantReasoningEffortLabelKey(null)).toBe('Model default')
        expect(getAssistantReasoningEffortLabelKey('xhigh')).toBe('XHigh')
        expect(getAssistantReasoningEffortLabelKey('max')).toBe('Max')
    })
})
