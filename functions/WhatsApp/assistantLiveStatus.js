const WAITING = new Set([
    'requires_auth',
    'waiting_for_auth_refresh',
    'confirmation_required',
    'requires_approval',
    'awaiting_user',
])
const CANCELLED = new Set([
    'cancelled',
    'canceled',
    'cancel_requested',
    'request_changed',
    'voice_request_superseded',
    'not_executed',
])
const FAILED = new Set(['failed', 'error', 'blocked', 'permission_denied', 'interrupted'])
const GENERIC_CAUSE =
    /^(?:error|failed|failure|unknown|internal|internal error|unknown error|an (?:unexpected )?error (?:occurred|has occurred)|(?:tool call|request|backend) failed|backend_failed|interrupted|something went wrong|the tool returned no successful result)[.!]?$/i

function sanitizeVoiceCause(value) {
    if (typeof value !== 'string' || !value.trim() || GENERIC_CAUSE.test(value.trim())) return null
    const cause = value
        .replace(/Bearer\s+\S+|\b(?:sk-|ghp_|glpat-|ya29\.)[A-Za-z0-9._-]+/gi, '[credential omitted]')
        .replace(/https?:\/\/\S+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[address omitted]')
        .replace(/[A-Za-z0-9+/_=-]{40,}/g, '[identifier omitted]')
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
    // Redaction must not leave a credential or address masquerading as a cause.
    return !GENERIC_CAUSE.test(cause) &&
        /[\p{L}\p{N}]/u.test(cause.replace(/\[(?:credential|address|identifier) omitted\]/g, ''))
        ? cause
        : null
}

function voiceOperationOutcome(result, error) {
    const status = result?.status
    const exception = error?.code || error?.message || error
    if (CANCELLED.has(exception) || CANCELLED.has(status))
        return { status: status === 'cancel_requested' ? 'cancel_requested' : 'cancelled', cause: null }
    if (!error && WAITING.has(status))
        return {
            status: ['requires_auth', 'waiting_for_auth_refresh'].includes(status) ? 'requires_auth' : 'awaiting_user',
            cause: null,
        }
    const failed =
        !!error ||
        result?.success === false ||
        result?.isError === true ||
        FAILED.has(status) ||
        (Number.isInteger(status) && status >= 400 && status <= 599)
    if (!failed) return { status: result == null ? 'outcome_unconfirmed' : 'result_received', cause: null }
    // Contradictory response flags are not proof of either success or failure.
    if (!error && result?.success === true) return { status: 'outcome_unconfirmed', cause: null }
    const candidates = [
        error?.message,
        typeof error === 'string' ? error : null,
        typeof result?.error === 'string' ? result.error : result?.error?.message,
        result?.failureReason,
        result?.isError === true && Array.isArray(result.content)
            ? result.content
                  .filter(item => item?.type === 'text' && typeof item.text === 'string')
                  .map(item => item.text)
                  .join(' ')
            : null,
        result?.message,
        error?.code,
        result?.error?.code,
        result?.errorCode,
        Number.isInteger(status) && status >= 400 && status <= 599 ? `HTTP ${status}` : null,
    ]
    const cause = candidates.map(sanitizeVoiceCause).find(Boolean) || null
    return { status: cause ? 'failed' : 'outcome_unconfirmed', cause }
}

const STATES = new Set([
    'running',
    'result_received',
    'outcome_unconfirmed',
    'waiting',
    'queued',
    'starting',
    'requires_auth',
    'awaiting_user',
    'cancel_requested',
    'cancelled',
    'completed',
    'failed',
])
function liveStatus(value) {
    if (!value || typeof value !== 'object' || !STATES.has(value.status)) return null
    const cause = value.status === 'failed' ? sanitizeVoiceCause(value.cause) : null
    const active = (Array.isArray(value.active) ? value.active : [])
        .filter(label => typeof label === 'string')
        .slice(0, 2)
    return {
        status: value.status === 'failed' && !cause ? 'outcome_unconfirmed' : value.status,
        cause,
        scope: typeof value.scope === 'string' ? value.scope.slice(0, 80) : 'request',
        step: typeof value.step === 'string' ? value.step : '',
        active,
        activeCount: Number.isSafeInteger(value.activeCount)
            ? Math.max(active.length, value.activeCount)
            : active.length,
    }
}

function describeLiveStatus(value) {
    const state = liveStatus(value)
    if (!state) return ''
    const step = state.step ? `The step “${state.step}”` : 'The request'
    const parts = []
    if (state.status === 'failed') parts.push(`${step} could not complete: “${state.cause}”.`)
    if (state.status === 'outcome_unconfirmed') parts.push(`${step} has no confirmed outcome or specific cause yet.`)
    if (state.status === 'waiting') parts.push(`${step} is waiting for the required input or connection.`)
    if (state.status === 'queued') parts.push(`${step} is queued and waiting for previous work to finish.`)
    if (state.status === 'starting') parts.push(`${step} is starting; no result is available yet.`)
    if (state.status === 'requires_auth') parts.push(`${step} is waiting for its connection to be restored.`)
    if (state.status === 'awaiting_user') parts.push(`${step} needs your input in chat.`)
    if (state.status === 'cancel_requested') parts.push(`${step} cancellation was requested, but is not confirmed.`)
    if (state.status === 'cancelled') parts.push(`${step} was stopped or replaced; completion is not confirmed.`)
    if (state.active.length) {
        const extra = state.activeCount - state.active.length
        parts.push(
            `Currently: ${state.active.join('; ')}${extra > 0 ? `; plus ${extra} other lookup${extra > 1 ? 's' : ''}` : ''}.`
        )
    } else if (state.status === 'result_received') {
        parts.push(`${step} returned a result. I am checking that result before answering.`)
    } else if (state.status === 'completed') parts.push(`${step} has finished. Check its result for the outcome.`)
    else if (state.status === 'running') parts.push(`${step} is still running; its result is not ready yet.`)
    return parts.join(' ')
}

function statusUpdate(value) {
    const status = liveStatus(value)
    return status && { ...status, content: describeLiveStatus(status), urgent: status.status === 'failed' }
}

function limitBytes(text, max) {
    let result = ''
    for (const char of text) {
        if (Buffer.byteLength(result + char, 'utf8') > max) break
        result += char
    }
    return result
}

// A plain-string Live append with a small, application-owned envelope. Never
// infer an error from tool subjects, fetched text, model prose or elapsed time.
function formatLiveStatus(value, { errorContextOnly = false } = {}) {
    const state = liveStatus(value)
    if (!state) return null
    const data = {
        type: errorContextOnly ? 'application_error_state' : 'application_status',
        scope: limitBytes(state.scope, 80),
        error:
            state.status === 'failed'
                ? { status: 'failed', cause: limitBytes(state.cause, 180), step: limitBytes(state.step, 80) }
                : null,
    }
    if (!errorContextOnly) {
        data.status = state.status
        if (!data.error) data.step = limitBytes(state.step, 140)
        if (state.activeCount) {
            data.activeCount = state.activeCount
            data.active = state.active.map(label => limitBytes(label, 100))
        }
    }
    // JSON escaping can enlarge quotes/backslashes. Retain valid JSON and the
    // error's status + cause together within the 500-token Live API budget.
    while (Buffer.byteLength(JSON.stringify(data), 'utf8') > 480) {
        if (data.active?.length) data.active.pop()
        else if (data.step) data.step = Array.from(data.step).slice(0, -1).join('')
        else if (data.error?.step) data.error.step = Array.from(data.error.step).slice(0, -1).join('')
        else data.error.cause = Array.from(data.error.cause).slice(0, -1).join('')
    }
    return JSON.stringify(data)
}

module.exports = {
    voiceOperationOutcome,
    sanitizeVoiceCause,
    liveStatus,
    statusUpdate,
    describeLiveStatus,
    formatLiveStatus,
}
