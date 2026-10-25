'use strict'

const moment = require('moment-timezone')

/**
 * AT-2480 - the user's LOCAL day, resolved in exactly one place.
 *
 * `syncCalendarEvents` fetches one day of events and it is the user's local day, not UTC and not
 * the caller's. The scheduled sync has to answer "has this user already been synced for the day
 * they are currently in?", which is the same question about the same day - so the two must not
 * each carry their own copy of the timezone resolution. A drift there is silent and nasty: the
 * marker would name a different day than the window that was fetched, and the user would either
 * be synced twice or (worse) not at all around their local midnight.
 *
 * The rules below are lifted verbatim from the inline block that used to live in
 * `serverSideCalendarSync.js`, including its quirks, because production data depends on them:
 * `timezone` is usually an INTEGER offset in hours (2 for Berlin), not an IANA name, and a small
 * number is therefore multiplied by 60 while a large one is already minutes. `preferredTimezone`
 * (a real IANA name) is deliberately NOT consulted here - the sync never read it, and starting to
 * would silently move every existing user's day boundary.
 */

const resolveUserTimezone = (userData = {}) =>
    (typeof userData?.timezone !== 'undefined' ? userData.timezone : null) ??
    (typeof userData?.timezoneOffset !== 'undefined' ? userData.timezoneOffset : null) ??
    (typeof userData?.timezoneMinutes !== 'undefined' ? userData.timezoneMinutes : null) ??
    0

const resolveTimezoneOffsetMinutes = timezone => {
    if (typeof timezone === 'string') {
        // An IANA timezone string (e.g. "Europe/Berlin").
        try {
            return moment.tz(timezone).utcOffset()
        } catch (error) {
            return 0
        }
    }

    if (typeof timezone === 'number') {
        // Already an offset. A small number is hours (2 -> 120); anything past the valid hour
        // range (-12..+14) is already minutes.
        return Math.abs(timezone) <= 16 ? timezone * 60 : timezone
    }

    return 0
}

const getUserLocalDayStart = (userData = {}, now = Date.now()) => {
    const timezone = resolveUserTimezone(userData)

    try {
        if (typeof timezone === 'string') return moment.tz(now, timezone).startOf('day')
        return moment(now).utcOffset(resolveTimezoneOffsetMinutes(timezone)).startOf('day')
    } catch (error) {
        console.error(`[calendarUserDay] Error parsing timezone '${timezone}':`, error)
        return moment.utc(now).startOf('day')
    }
}

/**
 * The key the scheduled sync remembers per user+project. It names the local day that was fetched,
 * so "already synced today" flips exactly when the user's own midnight passes - never at UTC
 * midnight, which for a user west of Greenwich would fall in the middle of their afternoon.
 */
const getUserLocalDateKey = (userData = {}, now = Date.now()) =>
    getUserLocalDayStart(userData, now).format('YYYY-MM-DD')

module.exports = {
    resolveUserTimezone,
    resolveTimezoneOffsetMinutes,
    getUserLocalDayStart,
    getUserLocalDateKey,
}
