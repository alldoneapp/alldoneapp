const { getEnvFunctions } = require('../envFunctionsHelper')

const REGION = 'europe-west1'
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2'
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper'
const DEFAULT_REALTIME_VOICE = 'marin'
const DEFAULT_REASONING_EFFORT = 'medium'
const DEFAULT_MAX_DURATION_SECONDS = 1800
const ROUTING_TOKEN_TTL_MS = 2 * 60 * 1000
const CALL_LEASE_GRACE_MS = 5 * 60 * 1000

const REALTIME_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar']

function getBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function getPositiveInteger(value, fallback) {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getProjectId() {
    if (process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT) {
        return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    }

    try {
        const config = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
        if (config?.projectId) return config.projectId
    } catch (_) {}

    try {
        return require('firebase-admin').app().options.projectId || ''
    } catch (_) {
        return ''
    }
}

function getFunctionUrl(functionName) {
    const projectId = getProjectId() || 'alldonealeph'
    if (process.env.FUNCTIONS_EMULATOR) {
        return `http://localhost:5001/${projectId}/${REGION}/${functionName}`
    }
    return `https://${REGION}-${projectId}.cloudfunctions.net/${functionName}`
}

function getWhatsAppCallConfig() {
    const env = getEnvFunctions()
    const value = key => env[key] || process.env[key] || ''
    const maxDurationSeconds = Math.min(
        DEFAULT_MAX_DURATION_SECONDS,
        getPositiveInteger(value('WHATSAPP_CALL_MAX_DURATION_SECONDS'), DEFAULT_MAX_DURATION_SECONDS)
    )

    return {
        enabled: getBoolean(value('WHATSAPP_CALLS_ENABLED'), false),
        phoneCallsEnabled: getBoolean(value('PHONE_CALLS_ENABLED'), false),
        browserCallsEnabled: getBoolean(value('BROWSER_CALLS_ENABLED'), false),
        openAiApiKey: value('OPEN_AI_KEY') || value('OPENAI_API_KEY'),
        openAiProjectId: value('OPENAI_PROJECT_ID'),
        openAiWebhookSecret: value('OPENAI_WEBHOOK_SECRET'),
        routingTokenSecret: value('WHATSAPP_CALL_ROUTING_SECRET'),
        realtimeModel: value('OPENAI_REALTIME_MODEL') || DEFAULT_REALTIME_MODEL,
        transcriptionModel: value('OPENAI_REALTIME_TRANSCRIPTION_MODEL') || DEFAULT_TRANSCRIPTION_MODEL,
        reasoningEffort: value('OPENAI_REALTIME_REASONING_EFFORT') || DEFAULT_REASONING_EFFORT,
        maxDurationSeconds,
        routeTokenTtlMs: ROUTING_TOKEN_TTL_MS,
        callLeaseMs: maxDurationSeconds * 1000 + CALL_LEASE_GRACE_MS,
        twilioIncomingCallUrl: getFunctionUrl('whatsAppIncomingCall'),
        twilioStatusCallbackUrl: getFunctionUrl('whatsAppCallStatusCallback'),
        phoneIncomingCallUrl: getFunctionUrl('phoneIncomingCall'),
        phoneStatusCallbackUrl: getFunctionUrl('phoneCallStatusCallback'),
        openAiWebhookUrl: getFunctionUrl('openAIRealtimeCallWebhook'),
    }
}

function normalizeRealtimeVoice(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
    return REALTIME_VOICES.includes(normalized) ? normalized : DEFAULT_REALTIME_VOICE
}

module.exports = {
    REGION,
    DEFAULT_REALTIME_MODEL,
    DEFAULT_TRANSCRIPTION_MODEL,
    DEFAULT_REALTIME_VOICE,
    DEFAULT_REASONING_EFFORT,
    REALTIME_VOICES,
    getFunctionUrl,
    getWhatsAppCallConfig,
    normalizeRealtimeVoice,
}
