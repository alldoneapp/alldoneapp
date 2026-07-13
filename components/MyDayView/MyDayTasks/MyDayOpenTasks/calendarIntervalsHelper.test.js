import { getCalendarTaskStartAndEndTimestamp } from './calendarIntervalsHelper'

describe('getCalendarTaskStartAndEndTimestamp', () => {
    it('uses a zero-minute interval for all-day events', () => {
        const firstLoginDateInDay = Date.parse('2026-07-13T08:00:00+02:00')
        const calendarData = {
            start: { date: '2026-07-13' },
            end: { date: '2026-07-14' },
        }

        expect(getCalendarTaskStartAndEndTimestamp(calendarData, firstLoginDateInDay)).toEqual({
            startDateTimestamp: firstLoginDateInDay,
            endDateTimestamp: firstLoginDateInDay,
        })
    })

    it('preserves the real interval for timed events', () => {
        const calendarData = {
            start: { dateTime: '2026-07-13T08:00:00+02:00' },
            end: { dateTime: '2026-07-13T16:00:00+02:00' },
        }

        expect(getCalendarTaskStartAndEndTimestamp(calendarData, 0)).toEqual({
            startDateTimestamp: Date.parse(calendarData.start.dateTime),
            endDateTimestamp: Date.parse(calendarData.end.dateTime),
        })
    })
})
