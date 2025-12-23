// Performance optimization configuration
module.exports = {
    // Firestore settings
    FIRESTORE_SETTINGS: {
        ignoreUndefinedProperties: true,
        cacheSizeBytes: 50 * 1024 * 1024, // 50MB cache
        experimentalAutoDetectLongPolling: true,
        merge: true,
    },

    // Cache TTLs (in milliseconds)
    CACHE_TTL: {
        ASSISTANT: 5 * 60 * 1000, // 5 minutes
        USER: 60 * 1000, // 1 minute
        ENVIRONMENT: 10 * 60 * 1000, // 10 minutes
    },

    // Query limits
    QUERY_LIMITS: {
        MESSAGES: 10, // Reduced from 50
        CONTEXT_MESSAGES: 5, // Maximum messages in context
    },

    // Performance monitoring
    ENABLE_DETAILED_LOGGING: false, // Disabled to improve stream processing performance (reduces 70s to ~5-10s)

    // Model configurations
    MODEL_CONFIG: {
        MODEL_GPT5_1: {
            actual: 'gpt-5.1',
            maxTokens: 4096,
            temperature: 1.0,
        },
        MODEL_GPT5_2: {
            actual: 'gpt-5.2',
            maxTokens: 4096,
            temperature: 1.0,
        },
        MODEL_GPT_4: {
            actual: 'gpt-4',
            maxTokens: 8192,
            temperature: 0.7,
        },
        MODEL_GPT_4_O: {
            actual: 'gpt-4o',
            maxTokens: 4096,
            temperature: 0.7,
        },
    },
}
