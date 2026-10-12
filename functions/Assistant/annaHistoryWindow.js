const moment = require('moment-timezone')

// Shared by the default history query and local cache hydration. Use calendar
// days in the account timezone, including 23/25-hour daylight-saving days.
function getAnnaHistoryWindow(user = {}, now = Date.now()) {
    const candidates = [user.timezone, user.preferredTimezone, user.timezoneOffset, user.timezoneMinutes]
    const zone = candidates.find(value => typeof value === 'string' && moment.tz.zone(value.trim()))
    let local = moment.utc(now)
    if (zone) local = local.tz(zone.trim())
    else {
        for (const value of [user.timezone, user.timezoneOffset, user.timezoneMinutes, user.preferredTimezone]) {
            if (value == null || String(value).trim() === '') continue
            const text = String(value)
                .trim()
                .replace(/^(UTC|GMT)/i, '')
            const match = text.match(/^([+-]?)(\d{1,2}):(\d{2})$/)
            let offset = match
                ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
                : text.toUpperCase() === 'Z'
                  ? 0
                  : Number(text)
            if (!Number.isFinite(offset) || (match && Number(match[3]) >= 60)) continue
            if (!match && Number.isInteger(offset) && Math.abs(offset) <= 16) offset *= 60
            local = local.utcOffset(offset)
            break
        }
    }
    const today = local.clone().startOf('day')
    const yesterday = today.clone().subtract(1, 'day')
    return {
        today: today.format('YYYYMMDD'),
        yesterday: yesterday.format('YYYYMMDD'),
        start: yesterday.valueOf(),
        end: today.clone().add(1, 'day').valueOf(),
    }
}

function isRecentAnnaThread(thread, window) {
    const date =
        thread.dateKey || thread.annaDateKey || (thread.chatId || thread.id || '').match(/^AnnaChat(\d{8})/)?.[1]
    if (date) return date === window.today || date === window.yesterday
    return Number(thread.created) >= window.start && Number(thread.created) < window.end
}

module.exports = { getAnnaHistoryWindow, isRecentAnnaThread }
