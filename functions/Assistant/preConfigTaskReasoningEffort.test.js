const {
    INHERIT_ASSISTANT_REASONING_EFFORT,
    MODEL_DEFAULT_REASONING_EFFORT,
    PRE_CONFIG_TASK_REASONING_EFFORT_OPTIONS,
    getPreConfigTaskReasoningEffortOverride,
    getPreConfigTaskReasoningEffortSelection,
    getPreConfigTaskReasoningEffortValue,
    resolvePreConfigTaskReasoningEffort,
} = require('./preConfigTaskReasoningEffort')

describe('pre-configured task reasoning effort selection', () => {
    test('offers assistant inheritance, model default, and every assistant effort level', () => {
        expect(PRE_CONFIG_TASK_REASONING_EFFORT_OPTIONS.map(option => option.value)).toEqual([
            INHERIT_ASSISTANT_REASONING_EFFORT,
            MODEL_DEFAULT_REASONING_EFFORT,
            'none',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ])
    })

    test('inherits from the assistant when the task has no override', () => {
        expect(getPreConfigTaskReasoningEffortOverride({})).toBeUndefined()
        expect(getPreConfigTaskReasoningEffortSelection({})).toBe(INHERIT_ASSISTANT_REASONING_EFFORT)
        expect(resolvePreConfigTaskReasoningEffort({}, 'high')).toBe('high')
    })

    test('preserves an explicit model-default override', () => {
        const task = { aiReasoningEffort: null }

        expect(getPreConfigTaskReasoningEffortOverride(task)).toBeNull()
        expect(getPreConfigTaskReasoningEffortSelection(task)).toBe(MODEL_DEFAULT_REASONING_EFFORT)
        expect(resolvePreConfigTaskReasoningEffort(task, 'high')).toBeNull()
        expect(getPreConfigTaskReasoningEffortValue(MODEL_DEFAULT_REASONING_EFFORT)).toBeNull()
    })

    test('preserves a valid task-level effort override', () => {
        const task = { aiReasoningEffort: 'xhigh' }

        expect(getPreConfigTaskReasoningEffortSelection(task)).toBe('xhigh')
        expect(resolvePreConfigTaskReasoningEffort(task, 'low')).toBe('xhigh')
        expect(getPreConfigTaskReasoningEffortValue('xhigh')).toBe('xhigh')
    })

    test('treats invalid and inherit selections as no override', () => {
        expect(getPreConfigTaskReasoningEffortOverride({ aiReasoningEffort: 'minimal' })).toBeUndefined()
        expect(getPreConfigTaskReasoningEffortValue('minimal')).toBeUndefined()
        expect(getPreConfigTaskReasoningEffortValue(INHERIT_ASSISTANT_REASONING_EFFORT)).toBeUndefined()
    })
})
