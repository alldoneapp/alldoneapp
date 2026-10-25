'use strict'

// Shared by the scheduler and the chat status UI. The scheduled worker currently
// enforces the default as a floor, even when settings store a shorter interval.
const DEFAULT_SYNC_INTERVAL_MINUTES = 30

function getConfiguredSyncIntervalMinutes(config = {}) {
    const parsedInterval = Number(config?.syncIntervalMinutes)
    if (!Number.isFinite(parsedInterval)) return DEFAULT_SYNC_INTERVAL_MINUTES
    return Math.max(DEFAULT_SYNC_INTERVAL_MINUTES, Math.trunc(parsedInterval))
}

module.exports = { DEFAULT_SYNC_INTERVAL_MINUTES, getConfiguredSyncIntervalMinutes }
