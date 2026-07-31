/**
 * Values accepted by reasoning.effort for the selectable GPT-5.6 assistant models.
 * A null value represents the product-level "Model default" choice and must be
 * omitted from the API request.
 *
 * @typedef {'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'} AssistantReasoningEffort
 */
const SELECTABLE_ASSISTANT_REASONING_EFFORTS = [
    { value: null, labelKey: 'Model default' },
    { value: 'none', labelKey: 'None' },
    { value: 'low', labelKey: 'Low' },
    { value: 'medium', labelKey: 'Medium' },
    { value: 'high', labelKey: 'High' },
    { value: 'xhigh', labelKey: 'XHigh' },
    { value: 'max', labelKey: 'Max' },
]

const VALID_ASSISTANT_REASONING_EFFORTS = SELECTABLE_ASSISTANT_REASONING_EFFORTS.map(option => option.value).filter(
    value => value !== null
)

const isValidAssistantReasoningEffort = value => VALID_ASSISTANT_REASONING_EFFORTS.includes(value)

const normalizeAssistantReasoningEffort = value => (isValidAssistantReasoningEffort(value) ? value : null)

const resolveAssistantReasoningEffort = (settings = {}, fallbackValue = null) =>
    Object.prototype.hasOwnProperty.call(settings, 'reasoningEffort')
        ? normalizeAssistantReasoningEffort(settings.reasoningEffort)
        : normalizeAssistantReasoningEffort(fallbackValue)

const getAssistantReasoningEffortLabelKey = value => {
    const normalizedValue = normalizeAssistantReasoningEffort(value)
    return SELECTABLE_ASSISTANT_REASONING_EFFORTS.find(option => option.value === normalizedValue).labelKey
}

module.exports = {
    SELECTABLE_ASSISTANT_REASONING_EFFORTS,
    VALID_ASSISTANT_REASONING_EFFORTS,
    isValidAssistantReasoningEffort,
    normalizeAssistantReasoningEffort,
    resolveAssistantReasoningEffort,
    getAssistantReasoningEffortLabelKey,
}
