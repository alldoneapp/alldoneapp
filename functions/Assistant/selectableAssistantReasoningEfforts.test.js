const {
    SELECTABLE_ASSISTANT_REASONING_EFFORTS,
    VALID_ASSISTANT_REASONING_EFFORTS,
    isValidAssistantReasoningEffort,
    normalizeAssistantReasoningEffort,
    getAssistantReasoningEffortLabelKey,
} = require('./selectableAssistantReasoningEfforts')

describe('selectable assistant reasoning efforts', () => {
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

    test('returns exact UI labels, including XHigh and Max', () => {
        expect(getAssistantReasoningEffortLabelKey(null)).toBe('Model default')
        expect(getAssistantReasoningEffortLabelKey('xhigh')).toBe('XHigh')
        expect(getAssistantReasoningEffortLabelKey('max')).toBe('Max')
    })
})
