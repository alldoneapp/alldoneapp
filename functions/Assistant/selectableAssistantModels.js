const SELECTABLE_ASSISTANT_MODELS = [
    {
        model: 'MODEL_GPT5_6_SOL',
        labelKey: 'GPT 5_6 Sol',
        name: 'Sol',
        descriptionKey: 'Most capable',
    },
    {
        model: 'MODEL_GPT5_6_TERRA',
        labelKey: 'GPT 5_6 Terra',
        name: 'Terra',
        descriptionKey: 'Balanced cost and capability',
    },
    {
        model: 'MODEL_GPT5_6_LUNA',
        labelKey: 'GPT 5_6 Luna',
        name: 'Luna',
        descriptionKey: 'Efficient for high-volume work',
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
    },
]

module.exports = { SELECTABLE_ASSISTANT_MODELS }
