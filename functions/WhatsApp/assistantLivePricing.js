// Shared with the call UI. Voice is duration-priced; backend reasoning uses the
// current assistant's normal model rate. Rates are frozen on each call/run.
const LIVE_MODEL = 'gpt-live-1'
// 10,000 Gold costs EUR 49 (confirmed 2026-09-11). 40 Gold/min is EUR 0.196
// retail against USD 0.05/min upstream, leaving room for tax, fees and hosting.
const LIVE_GOLD_PER_MINUTE = 40
const LIVE_INITIALIZATION_SECONDS = 15
const LIVE_USD_PER_MINUTE = 0.05

function calculateLiveVoiceGold(seconds, goldPerMinute = LIVE_GOLD_PER_MINUTE) {
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(goldPerMinute) || goldPerMinute <= 0) {
        throw new Error('Invalid live voice price or duration')
    }
    return Math.ceil((Math.max(LIVE_INITIALIZATION_SECONDS, seconds) * goldPerMinute) / 60)
}

module.exports = {
    LIVE_MODEL,
    LIVE_GOLD_PER_MINUTE,
    LIVE_INITIALIZATION_SECONDS,
    LIVE_USD_PER_MINUTE,
    calculateLiveVoiceGold,
}
