const { getAnnaHistoryWindow, isRecentAnnaThread } = require('./annaHistoryWindow')
const { getUserLocalDayBounds } = require('./contextTimestampHelper')

it.each([
    ['Europe/Berlin', '2026-10-26T10:00:00Z', 49],
    ['Europe/Berlin', '2026-03-30T10:00:00Z', 47],
    ['America/New_York', '2026-10-12T01:00:00Z', 48],
    [2, '2026-10-12T01:00:00Z', 48],
    ['UTC+05:30', '2026-10-12T01:00:00Z', 48],
])('uses two calendar days for %s at %s', (timezone, now, hours) => {
    const user = { timezone }
    const time = Date.parse(now)
    const window = getAnnaHistoryWindow(user, time)
    const today = getUserLocalDayBounds(user, time)
    const yesterday = getUserLocalDayBounds(user, today.startOfDay - 1)
    expect(window.start).toBe(yesterday.startOfDay)
    expect(window.end).toBe(today.endOfDay + 1)
    expect((window.end - window.start) / 3600000).toBe(hours)
})

it('uses the named timezone before a stale numeric offset and never fills gaps with older threads', () => {
    const window = getAnnaHistoryWindow(
        { timezone: 1, preferredTimezone: 'Europe/Berlin' },
        Date.parse('2026-10-11T22:30:00Z')
    )
    expect(window.today).toBe('20261012')
    expect(window.yesterday).toBe('20261011')
    expect(isRecentAnnaThread({ chatId: 'AnnaChat20261012u1' }, window)).toBe(true)
    expect(isRecentAnnaThread({ dateKey: '20261011' }, window)).toBe(true)
    expect(isRecentAnnaThread({ chatId: 'AnnaChat20261009u1' }, window)).toBe(false)
    expect(isRecentAnnaThread({ chatId: 'anna_u1', created: 0 }, window)).toBe(false)
})
