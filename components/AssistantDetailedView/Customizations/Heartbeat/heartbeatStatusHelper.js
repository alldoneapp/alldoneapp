export function getHeartbeatStatusForUser(assistant, userId, intervalMs, now = Date.now()) {
    const lastCheckedAt = getTimestamp(
        assistant?.heartbeatLastCheckedByUser?.[userId] ?? assistant?.heartbeatLastProcessedWindowByUser?.[userId]
    )
    const lastExecutedAt = getTimestamp(assistant?.heartbeatLastExecutedByUser?.[userId])
    const lastSilentOkAt = getTimestamp(assistant?.heartbeatLastSilentOkByUser?.[userId])
    const lastFailureAt = getTimestamp(assistant?.heartbeatLastFailureByUser?.[userId])
    const lastFailureMessage = getString(assistant?.heartbeatLastFailureMessageByUser?.[userId])
    const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0

    const latestResultAt = Math.max(lastExecutedAt || 0, lastSilentOkAt || 0, lastFailureAt || 0)
    const silentOkIsLatest =
        lastSilentOkAt !== null &&
        lastCheckedAt !== null &&
        lastSilentOkAt >= lastCheckedAt &&
        lastSilentOkAt >= latestResultAt

    const executedIsLatest =
        lastExecutedAt !== null &&
        lastCheckedAt !== null &&
        lastExecutedAt >= lastCheckedAt &&
        lastExecutedAt >= latestResultAt

    const failureIsLatest =
        lastFailureAt !== null &&
        lastCheckedAt !== null &&
        lastFailureAt >= lastCheckedAt &&
        lastFailureAt >= latestResultAt

    let lastResult
    if (lastCheckedAt === null) {
        lastResult = 'never'
    } else if (failureIsLatest) {
        lastResult = 'failed'
    } else if (silentOkIsLatest) {
        lastResult = 'silent_ok'
    } else if (executedIsLatest) {
        lastResult = 'executed'
    } else {
        lastResult = 'not_executed'
    }

    return {
        lastCheckedAt,
        lastExecutedAt,
        lastSilentOkAt,
        lastFailureAt,
        lastFailureMessage,
        hasRecentCheck:
            lastCheckedAt !== null && safeIntervalMs > 0 ? now - lastCheckedAt <= safeIntervalMs * 2 : false,
        lastResult,
    }
}

function getTimestamp(value) {
    const parsedValue = Number(value)
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null
}

function getString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}
