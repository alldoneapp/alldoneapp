import { getCalendarTagText, isAllDayCalendarEvent } from './calendarTagHelper'

describe('calendarTagHelper', () => {
    const allDayEvent = {
        start: { date: '2026-07-13' },
        end: { date: '2026-07-14' },
    }

    // The helper renders in the runtime's local zone, so the offset here has to
    // match the zone the suite runs in or the assertions below shift by it. The
    // npm test script pins TZ=UTC for exactly that reason; keep this in UTC too.
    const timedEvent = {
        start: { dateTime: '2026-07-13T08:00:00Z' },
        end: { dateTime: '2026-07-13T16:00:00Z' },
    }

    it('recognizes date-only calendar events as all-day events', () => {
        expect(isAllDayCalendarEvent(allDayEvent)).toBe(true)
        expect(isAllDayCalendarEvent(timedEvent)).toBe(false)
    })

    it('shows all-day events without a synthetic time range', () => {
        expect(getCalendarTagText(allDayEvent, 'HH:mm')).toBe('All day')
        expect(getCalendarTagText(allDayEvent, 'HH:mm', true)).toBe('All day')
    })

    it('keeps the time range for timed events', () => {
        expect(getCalendarTagText(timedEvent, 'HH:mm')).toBe('08:00 - 16:00')
        expect(getCalendarTagText(timedEvent, 'HH:mm', true)).toBe('08:00')
    })
})
