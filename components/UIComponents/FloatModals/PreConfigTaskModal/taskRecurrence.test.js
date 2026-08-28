import { getCurrentUserTaskRecurrence } from './taskRecurrence'

describe('getCurrentUserTaskRecurrence', () => {
    test('uses the current user recurrence ahead of the template recurrence', () => {
        expect(
            getCurrentUserTaskRecurrence(
                {
                    recurrence: 'daily',
                    recurrenceByUser: {
                        'user-1': 'weekly',
                        'user-2': 'monthly',
                    },
                },
                'user-1'
            )
        ).toBe('weekly')
    })

    test('falls back to the task recurrence when the current user has no override', () => {
        expect(
            getCurrentUserTaskRecurrence(
                {
                    recurrence: 'daily',
                    recurrenceByUser: { 'user-2': 'monthly' },
                },
                'user-1'
            )
        ).toBe('daily')
    })

    test('falls back to never when no recurrence is configured', () => {
        expect(getCurrentUserTaskRecurrence({}, 'user-1')).toBe('never')
    })
})
