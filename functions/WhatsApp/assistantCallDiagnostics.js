const EVENTS = new Set([
    'start',
    'resize',
    'orientation_change',
    'visibility_change',
    'online',
    'offline',
    'peer_state',
    'ice_state',
    'audio_playing',
    'audio_waiting',
    'audio_stalled',
    'cleanup',
    'page_context_update_failed',
    'microphone_acquired',
    'microphone_prepared',
    'microphone_changed',
    'microphone_first_signal',
    'microphone_sent',
    'microphone_muted',
    'microphone_unmuted',
    'microphone_ended',
    'microphone_recovering',
])
const REASONS = new Set([
    'cleanup',
    'component_unmounted',
    'app_unmounted',
    'account_changed',
    'disconnect_grace_expired',
    'peer_failed',
    'peer_closed',
    'user_hangup',
    'provider_closed',
    'data_channel_closed',
    'data_channel_error',
    'provider_error',
    'startup_timeout',
    'startup_failed',
    'session_ended_before_ready',
])
const STATES = new Set([
    'new',
    'connecting',
    'connected',
    'disconnected',
    'failed',
    'closed',
    'checking',
    'completed',
    'gathering',
    'complete',
    'open',
    'closing',
    'visible',
    'hidden',
    'portrait',
    'landscape',
    'live',
    'ended',
])
function sanitizeCallDiagnostics(value) {
    if (!value || typeof value !== 'object') return null
    const clean = row => {
        const result = {}
        for (const key of ['atMs', 'width', 'height', 'audioReadyState', 'inputBytesSent'])
            if (Number.isFinite(row?.[key]) && row[key] >= 0)
                result[key] = Math.min(
                    Math.round(row[key]),
                    key === 'inputBytesSent' ? Number.MAX_SAFE_INTEGER : key === 'atMs' ? 86400000 : 20000
                )
        for (const key of ['peerState', 'iceState', 'dataChannelState', 'visibility', 'orientation', 'micReadyState'])
            if (STATES.has(row?.[key])) result[key] = row[key]
        if (Number.isFinite(row?.inputLevelPermille))
            result.inputLevelPermille = Math.max(0, Math.min(1000, Math.round(row.inputLevelPermille)))
        for (const key of [
            'online',
            'audioPaused',
            'audioPlaybackReady',
            'micMuted',
            'micEnabled',
            'inputMonitorReady',
            'inputSending',
        ])
            if (typeof row?.[key] === 'boolean') result[key] = row[key]
        return result
    }
    return {
        reason: REASONS.has(value.reason) ? value.reason : 'cleanup',
        ...clean(value),
        events: (Array.isArray(value.events) ? value.events : [])
            .slice(-24)
            .filter(row => EVENTS.has(row?.event))
            .map(row => ({ event: row.event, ...clean(row) })),
    }
}
module.exports = { sanitizeCallDiagnostics }
