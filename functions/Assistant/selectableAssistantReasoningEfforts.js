/**
 * Values accepted by reasoning.effort for the selectable GPT-6 and GPT-5.6 assistant models.
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

// Keep the saved product key stable: existing Sol 6.0 selections now run on 6.1.
const isSolModel = model => !model || ['MODEL_GPT6_SOL', 'MODEL_GPT5_6_SOL', 'gpt-6-sol', 'gpt-6.1-sol'].includes(model)

const normalizeAssistantReasoningEffort = (value, model) =>
    value === 'none' && isSolModel(model) && model !== undefined
        ? 'high'
        : isValidAssistantReasoningEffort(value)
          ? value
          : null

const getAssistantReasoningEffortOptions = model =>
    isSolModel(model)
        ? SELECTABLE_ASSISTANT_REASONING_EFFORTS.filter(option => option.value !== 'none')
        : SELECTABLE_ASSISTANT_REASONING_EFFORTS

const resolveAssistantReasoningEffort = (settings = {}, fallbackValue = null) =>
    Object.prototype.hasOwnProperty.call(settings, 'reasoningEffort')
        ? normalizeAssistantReasoningEffort(settings.reasoningEffort, settings.model)
        : normalizeAssistantReasoningEffort(fallbackValue, settings.model)

const getAssistantReasoningEffortLabelKey = value => {
    const normalizedValue = normalizeAssistantReasoningEffort(value)
    return SELECTABLE_ASSISTANT_REASONING_EFFORTS.find(option => option.value === normalizedValue).labelKey
}

module.exports = {
    SELECTABLE_ASSISTANT_REASONING_EFFORTS,
    VALID_ASSISTANT_REASONING_EFFORTS,
    isValidAssistantReasoningEffort,
    normalizeAssistantReasoningEffort,
    getAssistantReasoningEffortOptions,
    resolveAssistantReasoningEffort,
    getAssistantReasoningEffortLabelKey,
}
