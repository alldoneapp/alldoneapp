const SELECTABLE_ASSISTANT_MODELS = [
    {
        model: 'MODEL_GPT6_SOL',
        labelKey: 'GPT 6.2 Sol',
        name: 'Sol',
        descriptionKey: 'Most capable',
        tokensPerGold: 200,
    },
    {
        model: 'MODEL_GPT5_6_TERRA',
        // The key predates GPT-6.1 Terra and stays as it is: it is persisted on assistants, chats,
        // Gmail and calendar configs, and `getModel` decides which release it runs on (AT-3163).
        labelKey: 'GPT 6.1 Terra',
        name: 'Terra',
        descriptionKey: 'Balanced cost and capability',
        // GPT-6.1 Terra lists at exactly half of Sol ($1/$5 vs $2/$10 per 1M tokens), so it is
        // billed at twice Sol's 200 tokens/Gold (product decision, AT-3163).
        tokensPerGold: 400,
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
        labelKey: 'DeepSeek V4.1 Flash',
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
