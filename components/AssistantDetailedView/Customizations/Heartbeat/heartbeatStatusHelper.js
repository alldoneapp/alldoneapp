export function getHeartbeatStatusForUser(assistant, userId, intervalMs, now = Date.now()) {
    const lastCheckedAt = getTimestamp(
        assistant?.heartbeatLastCheckedByUser?.[userId] ?? assistant?.heartbeatLastProcessedWindowByUser?.[userId]
    )
    const lastExecutedAt = getTimestamp(assistant?.heartbeatLastExecutedByUser?.[userId])
    const lastSilentOkAt = getTimestamp(assistant?.heartbeatLastSilentOkByUser?.[userId])
    const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0

    const silentOkIsLatest =
        lastSilentOkAt !== null &&
        lastCheckedAt !== null &&
        lastSilentOkAt >= lastCheckedAt &&
        (lastExecutedAt === null || lastSilentOkAt >= lastExecutedAt)

    const executedIsLatest =
        lastExecutedAt !== null &&
        lastCheckedAt !== null &&
        lastExecutedAt >= lastCheckedAt &&
        (lastSilentOkAt === null || lastExecutedAt > lastSilentOkAt)

    let lastResult
    if (lastCheckedAt === null) {
        lastResult = 'never'
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
        hasRecentCheck:
            lastCheckedAt !== null && safeIntervalMs > 0 ? now - lastCheckedAt <= safeIntervalMs * 2 : false,
        lastResult,
    }
}

function getTimestamp(value) {
    const parsedValue = Number(value)
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null
}
