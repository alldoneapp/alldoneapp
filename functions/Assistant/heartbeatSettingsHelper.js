const HEARTBEAT_INTERVAL_STEP_MS = 5 * 60 * 1000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000
const MIN_HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_STEP_MS
const MAX_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DEFAULT_AWAKE_START = 8 * 60 * 60 * 1000
const DEFAULT_AWAKE_END = 22 * 60 * 60 * 1000
const DEFAULT_PROMPT =
    'Check the done tasks today, comment on it and/or the chat history with one sentence and ask the user if he already did the focus task (remind him) or if there are any other ways you can help.'

const HEARTBEAT_OK_MARKER = 'HEARTBEAT_OK'

function isHeartbeatOkResponse(text) {
    if (typeof text !== 'string') return false
    return text.trim() === HEARTBEAT_OK_MARKER
}

function isHeartbeatOkPrefix(partial) {
    if (typeof partial !== 'string') return false
    const trimmed = partial.trimStart()
    if (trimmed.length === 0) return true
    if (trimmed.length > HEARTBEAT_OK_MARKER.length) {
        return trimmed.trimEnd() === HEARTBEAT_OK_MARKER
    }
    return HEARTBEAT_OK_MARKER.startsWith(trimmed)
}

function normalizeHeartbeatIntervalMs(value) {
    const parsedValue = Number(value)

    if (!Number.isFinite(parsedValue)) {
        return DEFAULT_HEARTBEAT_INTERVAL_MS
    }

    const roundedValue = Math.round(parsedValue / HEARTBEAT_INTERVAL_STEP_MS) * HEARTBEAT_INTERVAL_STEP_MS
    return Math.min(MAX_HEARTBEAT_INTERVAL_MS, Math.max(MIN_HEARTBEAT_INTERVAL_MS, roundedValue))
}

function normalizeHeartbeatChancePercent(value, fallback = 0) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) return fallback
    return Math.min(100, Math.max(0, parsedValue))
}

function normalizeHeartbeatTimeMs(value, fallback = 0) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) return fallback

    const roundedValue = Math.round(parsedValue / MINUTE_MS) * MINUTE_MS
    return ((roundedValue % DAY_MS) + DAY_MS) % DAY_MS
}

function parseHeartbeatTimeString(value) {
    if (typeof value !== 'string') return null

    const trimmedValue = value.trim()
    const match = /^(\d{1,2}):(\d{2})$/.exec(trimmedValue)
    if (!match) return null

    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

    return (hours * 60 + minutes) * MINUTE_MS
}

function formatHeartbeatTimeMs(value) {
    const normalizedValue = normalizeHeartbeatTimeMs(value, 0)
    const totalMinutes = Math.floor(normalizedValue / MINUTE_MS)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function formatHeartbeatIntervalMinutes(intervalMinutes) {
    const normalizedMinutes = Number(intervalMinutes)
    if (!Number.isFinite(normalizedMinutes)) return '30 minutes'
    return normalizedMinutes === 1 ? '1 minute' : `${normalizedMinutes} minutes`
}

function getEffectiveHeartbeatChancePercent(assistant = {}, projectId, userData = null) {
    if (assistant.heartbeatChancePercent !== undefined && assistant.heartbeatChancePercent !== null) {
        return normalizeHeartbeatChancePercent(assistant.heartbeatChancePercent, 0)
    }

    if (assistant.isDefault && userData?.defaultProjectId === projectId) {
        return 10
    }

    return 0
}

function getEffectiveHeartbeatSendWhatsApp(assistant = {}, userData = null) {
    if (assistant.heartbeatSendWhatsApp !== undefined && assistant.heartbeatSendWhatsApp !== null) {
        return assistant.heartbeatSendWhatsApp === true
    }

    return !!userData?.phone
}

function getEffectiveHeartbeatPrompt(assistant = {}) {
    if (assistant.heartbeatPrompt !== undefined && assistant.heartbeatPrompt !== null) {
        return String(assistant.heartbeatPrompt)
    }

    return DEFAULT_PROMPT
}

function getNormalizedHeartbeatSettings(assistant = {}, { projectId = null, userData = null } = {}) {
    const intervalMs = normalizeHeartbeatIntervalMs(assistant.heartbeatIntervalMs)
    const awakeStartMs = normalizeHeartbeatTimeMs(assistant.heartbeatAwakeStart, DEFAULT_AWAKE_START)
    const awakeEndMs = normalizeHeartbeatTimeMs(assistant.heartbeatAwakeEnd, DEFAULT_AWAKE_END)

    return {
        intervalMs,
        intervalMinutes: Math.round(intervalMs / MINUTE_MS),
        chancePercent: getEffectiveHeartbeatChancePercent(assistant, projectId, userData),
        awakeStartMs,
        awakeStartTime: formatHeartbeatTimeMs(awakeStartMs),
        awakeEndMs,
        awakeEndTime: formatHeartbeatTimeMs(awakeEndMs),
        sendWhatsApp: getEffectiveHeartbeatSendWhatsApp(assistant, userData),
        prompt: getEffectiveHeartbeatPrompt(assistant),
    }
}

function buildHeartbeatSettingsContextMessage(assistant = {}, { projectId = null, userData = null } = {}) {
    const settings = getNormalizedHeartbeatSettings(assistant, { projectId, userData })
    const heartbeatPromptHistoryLength = Array.isArray(assistant.heartbeatPromptHistory)
        ? assistant.heartbeatPromptHistory.length
        : 0

    return [
        'Current heartbeat settings for this assistant:',
        `- Awake time: ${settings.awakeStartTime} - ${settings.awakeEndTime} (user local time)`,
        `- Heartbeat interval: ${formatHeartbeatIntervalMinutes(settings.intervalMinutes)}`,
        `- Execution chance: ${settings.chancePercent}%`,
        `- WhatsApp notification: ${settings.sendWhatsApp ? 'enabled' : 'disabled'}`,
        `- heartbeatPromptHistory: ${heartbeatPromptHistoryLength} previous version(s) saved, up to 10 retained (rollback by passing the older prompt text back through update_heartbeat_settings).`,
        '- Current heartbeat prompt:',
        settings.prompt,
    ].join('\n')
}

module.exports = {
    HEARTBEAT_INTERVAL_STEP_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    MIN_HEARTBEAT_INTERVAL_MS,
    MAX_HEARTBEAT_INTERVAL_MS,
    DEFAULT_AWAKE_START,
    DEFAULT_AWAKE_END,
    DEFAULT_PROMPT,
    HEARTBEAT_OK_MARKER,
    isHeartbeatOkResponse,
    isHeartbeatOkPrefix,
    normalizeHeartbeatIntervalMs,
    normalizeHeartbeatChancePercent,
    normalizeHeartbeatTimeMs,
    parseHeartbeatTimeString,
    formatHeartbeatTimeMs,
    formatHeartbeatIntervalMinutes,
    getEffectiveHeartbeatChancePercent,
    getEffectiveHeartbeatSendWhatsApp,
    getEffectiveHeartbeatPrompt,
    getNormalizedHeartbeatSettings,
    buildHeartbeatSettingsContextMessage,
}
