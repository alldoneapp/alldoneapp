export function getHeartbeatStatusForUser(assistant, userId, intervalMs, now = Date.now()) {
    const lastCheckedAt = getTimestamp(
        assistant?.heartbeatLastCheckedByUser?.[userId] ?? assistant?.heartbeatLastProcessedWindowByUser?.[userId]
    )
    const lastExecutedAt = getTimestamp(assistant?.heartbeatLastExecutedByUser?.[userId])
    const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0

    return {
        lastCheckedAt,
        lastExecutedAt,
        hasRecentCheck:
            lastCheckedAt !== null && safeIntervalMs > 0 ? now - lastCheckedAt <= safeIntervalMs * 2 : false,
        lastResult:
            lastCheckedAt === null
                ? 'never'
                : lastExecutedAt !== null && lastExecutedAt >= lastCheckedAt
                ? 'executed'
                : 'not_executed',
    }
}

function getTimestamp(value) {
    const parsedValue = Number(value)
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null
}
