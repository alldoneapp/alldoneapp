const { LIVE_MODEL, LIVE_GOLD_PER_MINUTE } = require('./assistantLivePricing')

const LIVE_SIP_SETUP =
    'Enable GPT-Live SIP access in OPENAI_PROJECT_ID, subscribe live.transport.incoming to openAIRealtimeCallWebhook, and verify Twilio TLS/SRTP routing to that project.'

function getLiveConfigurationError(config, { sip = false } = {}) {
    const required = { openAiApiKey: 'OPEN_AI_KEY or OPENAI_API_KEY' }
    if (sip) {
        Object.assign(required, {
            openAiProjectId: 'OPENAI_PROJECT_ID',
            openAiWebhookSecret: 'OPENAI_WEBHOOK_SECRET',
            routingTokenSecret: 'WHATSAPP_CALL_ROUTING_SECRET',
        })
    }
    const missing = Object.entries(required)
        .filter(([key]) => !String(config[key] || '').trim())
        .map(([, name]) => name)
    return missing.length
        ? `GPT-Live setup incomplete. Configure ${missing.join(', ')}.${sip ? ` ${LIVE_SIP_SETUP}` : ''}`
        : null
}

function getLiveSessionDefaults() {
    return {
        voiceProvider: 'gpt-live',
        voiceModel: LIVE_MODEL,
        realtimeModel: null,
        voiceGoldPerMinute: LIVE_GOLD_PER_MINUTE,
        voiceSeconds: 0,
        voiceBilledGold: 0,
        backendBilledGold: 0,
        backendTokens: 0,
        voiceUsageFinal: false,
        controllerConnected: false,
    }
}

module.exports = { LIVE_SIP_SETUP, getLiveConfigurationError, getLiveSessionDefaults }
