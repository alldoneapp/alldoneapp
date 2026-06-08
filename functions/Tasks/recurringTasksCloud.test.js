const moment = require('moment')

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    getTaskNameWithoutMeta: text => text,
}))

const { calculateNextRecurrenceDate } = require('./recurringTasksCloud')

describe('recurringTasksCloud recurrence base dates', () => {
    const buildTask = overrides => ({
        recurrence: 'daily',
        created: moment('2026-06-01T09:00:00').valueOf(),
        startDate: moment('2026-06-01T09:00:00').valueOf(),
        startTime: '09:00',
        completed: moment('2026-06-08T10:00:00').valueOf(),
        ...overrides,
    })

    test('keeps current-date behavior when no override is provided', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(buildTask({ recurrence: 'daily' }), now)

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-09 09:00')
    })

    test('uses current-date override as the base date', () => {
        const currentDate = moment('2026-06-08T10:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'weekly',
                recurrenceBaseDateOverride: currentDate,
            }),
            currentDate
        )

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-15 09:00')
    })

    test('preserves original weekly cadence after postponed completion', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const originalDate = moment('2026-06-01T09:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'weekly',
                recurrenceBaseDateOverride: originalDate,
            }),
            now
        )

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-15 09:00')
    })

    test('uses a custom date override', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const customDate = moment('2026-06-10T00:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'weekly',
                recurrenceBaseDateOverride: customDate,
            }),
            now
        )

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-17 09:00')
    })

    test('advances stale monthly anchors to the next future occurrence', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const originalDate = moment('2026-05-01T09:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'monthly',
                recurrenceBaseDateOverride: originalDate,
            }),
            now
        )

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-07-01 09:00')
    })
})
