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

    test('adds the custom day interval with current-date behavior', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(buildTask({ recurrence: 'custom:28' }), now)

        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-07-06 09:00')
    })

    test('advances stale custom anchors to the next future occurrence', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const originalDate = moment('2026-05-01T09:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(
            buildTask({
                recurrence: 'custom:10',
                recurrenceBaseDateOverride: originalDate,
                completed: now,
            }),
            now
        )

        // 2026-05-01 + 10-day steps: 05-11, 05-21, 05-31, 06-10 (first strictly after 06-08)
        expect(nextDate.format('YYYY-MM-DD HH:mm')).toBe('2026-06-10 09:00')
    })

    test('returns null for an invalid custom value', () => {
        const now = moment('2026-06-08T10:00:00').valueOf()
        const nextDate = calculateNextRecurrenceDate(buildTask({ recurrence: 'custom:0' }), now)

        expect(nextDate).toBeNull()
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
