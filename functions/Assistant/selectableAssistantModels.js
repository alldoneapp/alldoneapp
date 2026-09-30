const SELECTABLE_ASSISTANT_MODELS = [
    {
        model: 'MODEL_GPT6_SOL',
        labelKey: 'GPT 6 Sol',
        name: 'Sol',
        descriptionKey: 'Most capable',
        tokensPerGold: 200,
    },
    {
        model: 'MODEL_GPT5_6_TERRA',
        labelKey: 'GPT 5_6 Terra',
        name: 'Terra',
        descriptionKey: 'Balanced cost and capability',
        tokensPerGold: 200,
    },
    {
        model: 'MODEL_GPT6_LUNA',
        labelKey: 'GPT 6 Luna',
        name: 'Luna',
        descriptionKey: 'Efficient for high-volume work',
        tokensPerGold: 1000,
    },
    {
        // Served through OpenRouter rather than OpenAI — see `assistantModelRouting.js`. The
        // difference is invisible here on purpose: this list is the product menu, and every
        // consumer of it (assistant model, heartbeat model, per-task override, Gmail labeling,
        // calendar routing) treats an entry the same way whichever upstream serves it.
        model: 'MODEL_DEEPSEEK_V4_FLASH',
        labelKey: 'DeepSeek V4 Flash',
        name: 'DeepSeek Flash',
        descriptionKey: 'Lowest cost, 1M context',
        // Assistant billing deliberately passes through only part of the upstream saving; this is
        // the actual divisor used by assistantHelper, not the separate VM-agent rate.
        tokensPerGold: 2000,
    },
]

function normalizeSelectableAssistantModelKey(modelKey) {
    return modelKey === 'MODEL_GPT5_6_SOL'
        ? 'MODEL_GPT6_SOL'
        : modelKey === 'MODEL_GPT5_6_LUNA'
          ? 'MODEL_GPT6_LUNA'
          : modelKey
}

function getAssistantModelTokensPerGold(modelKey) {
    const currentModelKey = normalizeSelectableAssistantModelKey(modelKey)
    const option = SELECTABLE_ASSISTANT_MODELS.find(model => model.model === currentModelKey)
    const tokens = Number(option?.tokensPerGold)
    return Number.isFinite(tokens) && tokens > 0 ? tokens : undefined
}

function formatAssistantModelTokensPerGold(value) {
    const tokens = Number(value)
    return Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens).toLocaleString() : ''
}

module.exports = {
    SELECTABLE_ASSISTANT_MODELS,
    normalizeSelectableAssistantModelKey,
    getAssistantModelTokensPerGold,
    formatAssistantModelTokensPerGold,
}
