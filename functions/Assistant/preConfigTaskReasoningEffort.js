const {
    SELECTABLE_ASSISTANT_REASONING_EFFORTS,
    normalizeAssistantReasoningEffort,
} = require('./selectableAssistantReasoningEfforts')

const INHERIT_ASSISTANT_REASONING_EFFORT = 'INHERIT_ASSISTANT_REASONING_EFFORT'
const MODEL_DEFAULT_REASONING_EFFORT = 'MODEL_DEFAULT_REASONING_EFFORT'

const PRE_CONFIG_TASK_REASONING_EFFORT_OPTIONS = [
    { value: INHERIT_ASSISTANT_REASONING_EFFORT, labelKey: 'Use assistant effort' },
    ...SELECTABLE_ASSISTANT_REASONING_EFFORTS.map(option => ({
        value: option.value === null ? MODEL_DEFAULT_REASONING_EFFORT : option.value,
        labelKey: option.labelKey,
    })),
]

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)

function getPreConfigTaskReasoningEffortOverride(task) {
    if (!hasOwn(task, 'aiReasoningEffort')) return undefined
    if (task.aiReasoningEffort === null) return null

    const normalizedValue = normalizeAssistantReasoningEffort(task.aiReasoningEffort)
    return normalizedValue === null ? undefined : normalizedValue
}

function getPreConfigTaskReasoningEffortSelection(task) {
    const override = getPreConfigTaskReasoningEffortOverride(task)
    if (override === undefined) return INHERIT_ASSISTANT_REASONING_EFFORT
    return override === null ? MODEL_DEFAULT_REASONING_EFFORT : override
}

function getPreConfigTaskReasoningEffortValue(selection) {
    if (selection === MODEL_DEFAULT_REASONING_EFFORT) return null
    if (selection === INHERIT_ASSISTANT_REASONING_EFFORT) return undefined

    const normalizedValue = normalizeAssistantReasoningEffort(selection)
    return normalizedValue === null ? undefined : normalizedValue
}

function resolvePreConfigTaskReasoningEffort(task, assistantReasoningEffort = null) {
    const override = getPreConfigTaskReasoningEffortOverride(task)
    return override === undefined ? normalizeAssistantReasoningEffort(assistantReasoningEffort) : override
}

module.exports = {
    INHERIT_ASSISTANT_REASONING_EFFORT,
    MODEL_DEFAULT_REASONING_EFFORT,
    PRE_CONFIG_TASK_REASONING_EFFORT_OPTIONS,
    getPreConfigTaskReasoningEffortOverride,
    getPreConfigTaskReasoningEffortSelection,
    getPreConfigTaskReasoningEffortValue,
    resolvePreConfigTaskReasoningEffort,
}
