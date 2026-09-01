'use strict'

const moment = require('moment-timezone')

const {
    getUserLocalDateKey,
    getUserLocalDayStart,
    resolveTimezoneOffsetMinutes,
    resolveUserTimezone,
} = require('./calendarUserDay')

describe('resolveUserTimezone', () => {
    // Production stores `timezone` as an INTEGER number of hours (2 for Berlin), not an IANA
    // name - `preferredTimezone` holds the name and is deliberately not consulted.
    it('prefers timezone, then timezoneOffset, then timezoneMinutes', () => {
        expect(resolveUserTimezone({ timezone: 2, timezoneOffset: 5 })).toBe(2)
        expect(resolveUserTimezone({ timezoneOffset: 5, timezoneMinutes: 600 })).toBe(5)
        expect(resolveUserTimezone({ timezoneMinutes: 600 })).toBe(600)
        expect(resolveUserTimezone({})).toBe(0)
    })

    it('keeps an explicit zero rather than falling through it', () => {
        expect(resolveUserTimezone({ timezone: 0, timezoneOffset: 5 })).toBe(0)
    })

    it('ignores preferredTimezone, which the sync has never read', () => {
        expect(resolveUserTimezone({ timezone: 2, preferredTimezone: 'Pacific/Auckland' })).toBe(2)
    })
})

describe('resolveTimezoneOffsetMinutes', () => {
    it('reads a small number as hours and a large one as minutes', () => {
        expect(resolveTimezoneOffsetMinutes(2)).toBe(120)
        expect(resolveTimezoneOffsetMinutes(-4)).toBe(-240)
        expect(resolveTimezoneOffsetMinutes(0)).toBe(0)
        expect(resolveTimezoneOffsetMinutes(330)).toBe(330)
    })

    it('resolves an IANA name', () => {
        expect(resolveTimezoneOffsetMinutes('Europe/Berlin')).toBe(moment.tz('Europe/Berlin').utcOffset())
    })

    it('falls back to UTC for anything it cannot read', () => {
        expect(resolveTimezoneOffsetMinutes(undefined)).toBe(0)
        expect(resolveTimezoneOffsetMinutes(null)).toBe(0)
    })
})

describe('getUserLocalDayStart', () => {
    // The exact window `syncCalendarEvents` fetches. Berlin at UTC+2 on 2026-09-01 06:08Z is
    // already 08:08 local, so its day started at 2026-08-31T22:00Z - the window the production
    // logs show.
    it('starts the day at the user local midnight for a numeric offset', () => {
        const now = Date.parse('2026-09-01T06:08:09.141Z')

        expect(getUserLocalDayStart({ timezone: 2 }, now).toDate().toISOString()).toBe('2026-08-31T22:00:00.000Z')
    })

    it('starts the day at the user local midnight for an IANA name', () => {
        const now = Date.parse('2026-09-01T06:08:09.141Z')
        const expected = moment.tz(now, 'Europe/Berlin').startOf('day').toDate().toISOString()

        expect(getUserLocalDayStart({ timezone: 'Europe/Berlin' }, now).toDate().toISOString()).toBe(expected)
    })

    // A user west of Greenwich is still on the previous date at 06:08Z. This is the whole reason
    // the scheduled sync ticks hourly instead of once at a fixed UTC hour.
    it('is still on the previous date for a negative offset', () => {
        const now = Date.parse('2026-09-01T06:08:09.141Z')

        expect(getUserLocalDayStart({ timezone: -8 }, now).toDate().toISOString()).toBe('2026-08-31T08:00:00.000Z')
    })

    it('falls back to UTC midnight with no timezone at all', () => {
        const now = Date.parse('2026-09-01T06:08:09.141Z')

        expect(getUserLocalDayStart({}, now).toDate().toISOString()).toBe('2026-09-01T00:00:00.000Z')
    })
})

describe('getUserLocalDateKey', () => {
    it('names the local day, not the UTC one', () => {
        const now = Date.parse('2026-09-01T06:08:09.141Z')

        expect(getUserLocalDateKey({ timezone: 2 }, now)).toBe('2026-09-01')
        expect(getUserLocalDateKey({ timezone: -8 }, now)).toBe('2026-08-31')
    })

    // The marker has to flip at the user's own midnight, which is the only moment their calendar
    // day actually changes.
    it('flips exactly at the user local midnight', () => {
        const justBefore = Date.parse('2026-09-01T21:59:59.000Z')
        const justAfter = Date.parse('2026-09-01T22:00:01.000Z')

        expect(getUserLocalDateKey({ timezone: 2 }, justBefore)).toBe('2026-09-01')
        expect(getUserLocalDateKey({ timezone: 2 }, justAfter)).toBe('2026-09-02')
    })

    // The key names the same day the fetch window covers - if these two ever disagree the user
    // is either synced twice or not at all around midnight.
    it('names the day whose start getUserLocalDayStart returns', () => {
        const now = Date.parse('2026-09-01T06:08:09.141Z')
        const userData = { timezone: -8 }

        expect(getUserLocalDayStart(userData, now).format('YYYY-MM-DD')).toBe(getUserLocalDateKey(userData, now))
    })
})
