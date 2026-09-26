const { toGoogleRecurrence, toMicrosoftRecurrence, resolveRecurringTarget } = require('./calendarRecurrence')

describe('calendar recurrence', () => {
    const start = { dateTime: '2026-10-05T09:00:00', timeZone: 'Europe/Berlin' }

    test('translates a weekly schedule and inclusive end date for both providers', () => {
        const schedule = {
            frequency: 'weekly',
            interval: 2,
            daysOfWeek: ['monday', 'wednesday'],
            endDate: '2026-12-30',
        }
        expect(toGoogleRecurrence(schedule, start)).toEqual([
            'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261230T225959Z',
        ])
        expect(toMicrosoftRecurrence(schedule, start)).toEqual({
            pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'wednesday'], firstDayOfWeek: 'monday' },
            range: {
                type: 'endDate',
                startDate: '2026-10-05',
                endDate: '2026-12-30',
                recurrenceTimeZone: 'Europe/Berlin',
            },
        })
    })

    test('supports counted daily and open monthly/yearly series', () => {
        expect(toGoogleRecurrence({ frequency: 'daily', count: 5 }, start)).toEqual([
            'RRULE:FREQ=DAILY;INTERVAL=1;COUNT=5',
        ])
        expect(toMicrosoftRecurrence({ frequency: 'monthly' }, start).pattern).toEqual({
            type: 'absoluteMonthly',
            interval: 1,
            dayOfMonth: 5,
        })
        expect(toMicrosoftRecurrence({ frequency: 'yearly' }, start).pattern).toEqual({
            type: 'absoluteYearly',
            interval: 1,
            dayOfMonth: 5,
            month: 10,
        })
        expect(toMicrosoftRecurrence({ frequency: 'daily', count: 5 }, start).range).toMatchObject({
            type: 'numbered',
            numberOfOccurrences: 5,
        })
    })

    test('uses a date UNTIL for an all-day series', () => {
        expect(toGoogleRecurrence({ frequency: 'daily', endDate: '2026-10-07' }, { date: '2026-10-05' })).toEqual([
            'RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20261007',
        ])
    })

    test.each([
        [{ frequency: 'sometimes' }, /frequency/],
        [{ frequency: 'daily', interval: 0 }, /interval/],
        [{ frequency: 'weekly', daysOfWeek: ['tuesday'] }, /first event weekday/],
        [{ frequency: 'daily', daysOfWeek: ['monday'] }, /daysOfWeek/],
        [{ frequency: 'daily', count: 2, endDate: '2026-11-01' }, /either/],
        [{ frequency: 'daily', endDate: '2026-02-30' }, /valid/],
        [{ frequency: 'daily', surprise: true }, /Unsupported/],
    ])('rejects an invalid schedule before writing', (schedule, message) => {
        expect(() => toGoogleRecurrence(schedule, start)).toThrow(message)
        expect(() => toMicrosoftRecurrence(schedule, start)).toThrow(message)
    })

    test('rejects dates with provider-dependent monthly or yearly behavior', () => {
        const lastDay = { dateTime: '2026-10-31T09:00:00', timeZone: 'Europe/Berlin' }
        expect(() => toGoogleRecurrence({ frequency: 'monthly' }, lastDay)).toThrow('consistently')
        expect(() => toMicrosoftRecurrence({ frequency: 'yearly' }, lastDay)).toThrow('consistently')
    })

    test('requires an IANA timezone for timed recurrence', () => {
        expect(() => toGoogleRecurrence({ frequency: 'daily' }, '2026-10-05T09:00:00+02:00')).toThrow('IANA timeZone')
    })

    test('requires an explicit scope and resolves series master IDs', () => {
        expect(resolveRecurringTarget({ recurringEventId: 'master' }, 'instance', undefined, 'google').error.code).toBe(
            'calendar_recurrence_scope_required'
        )
        expect(resolveRecurringTarget({ recurringEventId: 'master' }, 'instance', 'occurrence', 'google').eventId).toBe(
            'instance'
        )
        expect(resolveRecurringTarget({ recurringEventId: 'master' }, 'instance', 'series', 'google').eventId).toBe(
            'master'
        )
        expect(
            resolveRecurringTarget({ type: 'occurrence', seriesMasterId: 'master' }, 'instance', 'series', 'microsoft')
                .eventId
        ).toBe('master')
        expect(resolveRecurringTarget({ type: 'seriesMaster' }, 'master', 'occurrence', 'microsoft').error.code).toBe(
            'calendar_occurrence_id_required'
        )
    })
})
