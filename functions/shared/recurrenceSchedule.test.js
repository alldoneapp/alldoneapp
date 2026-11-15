const moment = require('moment')

const { createRecurrenceSchedule } = require('./recurrenceSchedule')
const { calculateNextRecurrenceDate } = require('../Tasks/recurringTasksCloud')
// The completion popup's preview (web code, AT-3049). It must name the day the server creates.
const {
    getNextRecurrenceDatePreview,
    toRecurrenceBaseDate,
} = require('../../components/UIComponents/FloatModals/RecurringTaskDateBasisModal/recurringTaskDateBasis')

// TZ=UTC in this suite (ci/jest.functions.config.js), so the browser day and the server day agree.
const at = value => moment.utc(value).valueOf()
const { getNextDateFromBaseDate, computeNextRecurrence } = createRecurrenceSchedule(moment)

describe('shared recurrence arithmetic', () => {
    test.each([
        ['2026-11-13', '2026-11-16'], // Friday -> Monday
        ['2026-11-14', '2026-11-16'], // Saturday -> Monday
        ['2026-11-15', '2026-11-16'], // Sunday -> Monday
        ['2026-11-16', '2026-11-17'], // Monday -> Tuesday
    ])('every workday from %s is %s', (from, to) => {
        expect(getNextDateFromBaseDate(moment.utc(from), 'everyWorkday').format('YYYY-MM-DD')).toBe(to)
    })

    test.each([
        ['daily', '2026-11-16'],
        ['weekly', '2026-11-22'],
        ['every2Weeks', '2026-11-29'],
        ['every3Weeks', '2026-12-06'],
        ['monthly', '2026-12-15'],
        ['every3Months', '2027-02-15'],
        ['every6Months', '2027-05-15'],
        ['annually', '2027-11-15'],
        ['custom:10', '2026-11-25'],
    ])('%s adds its interval', (recurrence, to) => {
        expect(getNextDateFromBaseDate(moment.utc('2026-11-15'), recurrence).format('YYYY-MM-DD')).toBe(to)
    })

    test('an unknown recurrence has no next date', () => {
        expect(getNextDateFromBaseDate(moment.utc('2026-11-15'), 'fortnightly')).toBeNull()
        expect(
            computeNextRecurrence({ recurrence: 'custom:0', startTime: '09:00' }, at('2026-11-15T10:00')).nextDate
        ).toBeNull()
    })
})

describe('AT-3049: the popup preview equals the date the server creates', () => {
    const NOW = at('2026-11-15T10:10:00') // Sunday
    const bases = {
        original: at('2026-11-07T09:00:00'),
        scheduled: at('2026-11-14T09:00:00'),
        today: NOW,
        custom: at('2026-10-31T09:00:00'),
    }
    const recurrences = [
        'daily',
        'everyWorkday',
        'weekly',
        'every2Weeks',
        'every3Weeks',
        'monthly',
        'every3Months',
        'every6Months',
        'annually',
        'custom:28',
    ]
    const cases = []
    recurrences.forEach(recurrence =>
        ['08:00', '18:00'].forEach(startTime =>
            Object.entries(bases).forEach(([basis, date]) => cases.push([recurrence, startTime, basis, date]))
        )
    )

    test.each(cases)('%s at %s from the %s date', (recurrence, startTime, basis, date) => {
        const task = { id: 't', recurrence, startTime, userIds: ['u'], dueDate: bases.scheduled }
        const server = calculateNextRecurrenceDate(
            { ...task, recurrenceBaseDateOverride: toRecurrenceBaseDate(date), completed: NOW },
            NOW,
            { utcOffsetMinutes: 0 }
        )
        const preview = getNextRecurrenceDatePreview(task, date, NOW)

        expect(server).not.toBeNull()
        expect(preview).toBe(server.valueOf())
        expect(preview).toBeGreaterThan(NOW)
    })

    test('the preview of the Weekly example in the screenshot', () => {
        const task = { recurrence: 'weekly', startTime: '09:00' }
        const day = value => moment.utc(getNextRecurrenceDatePreview(task, value, NOW)).format('ddd D MMM')
        expect(day(bases.scheduled)).toBe('Sat 21 Nov')
        expect(day(NOW)).toBe('Sun 22 Nov')
    })

    // The user is not in UTC. Jest cannot switch the process zone, so the browser's offset is
    // injected; the base timestamp is the local noon the client sends for that zone.
    test.each([
        ['Berlin', 60, 'daily', '2026-11-14T11:00:00Z', '09:15', '2026-11-15T09:20:00Z'],
        ['Berlin', 60, 'daily', '2026-11-14T11:00:00Z', '09:15', '2026-11-15T09:10:00Z'],
        ['Berlin', 60, 'weekly', '2026-11-13T11:00:00Z', '23:30', '2026-11-15T10:00:00Z'],
        ['Los Angeles', -480, 'daily', '2026-11-14T20:00:00Z', '02:00', '2026-11-15T19:00:00Z'],
        ['Los Angeles', -480, 'everyWorkday', '2026-11-13T20:00:00Z', '17:00', '2026-11-15T19:00:00Z'],
        ['Tokyo', 540, 'monthly', '2026-10-31T03:00:00Z', '08:00', '2026-11-15T01:00:00Z'],
    ])('in %s (%i min) %s from %s at %s, completed %s', (zone, offset, recurrence, localNoon, startTime, now) => {
        const completedAt = Date.parse(now)
        const sent = Date.parse(localNoon)
        const task = { recurrence, startTime }
        const server = calculateNextRecurrenceDate(
            { ...task, recurrenceBaseDateOverride: sent, completed: completedAt },
            completedAt,
            { utcOffsetMinutes: offset }
        )

        expect(server).not.toBeNull()
        expect(getNextRecurrenceDatePreview(task, sent, completedAt, offset)).toBe(server.valueOf())
    })

    test('no preview for Someday or an unknown recurrence', () => {
        expect(getNextRecurrenceDatePreview({ recurrence: 'weekly' }, Number.MAX_SAFE_INTEGER, NOW)).toBeNull()
        expect(getNextRecurrenceDatePreview({ recurrence: 'fortnightly' }, NOW, NOW)).toBeNull()
    })
})
