const { getUserLocalDateContext, resolveUserTimezoneName } = require('./contextTimestampHelper')

describe('contextTimestampHelper user-local date context', () => {
    test('uses the user timezone when the local day is ahead of UTC', () => {
        const result = getUserLocalDateContext({ timezone: 120 }, Date.UTC(2026, 3, 3, 22, 30, 0))

        expect(result).toEqual({
            dateKey: '20260404',
            dateLabel: '04 Apr 2026',
            timezoneOffsetMinutes: 120,
        })
    })

    test('uses the user timezone when the local day is behind UTC', () => {
        const result = getUserLocalDateContext({ timezone: -300 }, Date.UTC(2026, 3, 4, 2, 30, 0))

        expect(result).toEqual({
            dateKey: '20260403',
            dateLabel: '03 Apr 2026',
            timezoneOffsetMinutes: -300,
        })
    })

    test('falls back to UTC when the user has no timezone', () => {
        const result = getUserLocalDateContext({}, Date.UTC(2026, 3, 4, 2, 30, 0))

        expect(result).toEqual({
            dateKey: '20260404',
            dateLabel: '04 Apr 2026',
            timezoneOffsetMinutes: null,
        })
    })

    test('returns the user IANA timezone when available', () => {
        expect(resolveUserTimezoneName({ preferredTimezone: 'Europe/Berlin', timezone: 120 })).toBe('Europe/Berlin')
    })
})
