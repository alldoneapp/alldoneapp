import moment from 'moment'

import { formatDueDate } from './formatDueDate'

describe('formatDueDate', () => {
    const now = moment('2026-07-14T12:00:00')

    test('keeps dates in the current year compact', () => {
        expect(formatDueDate(moment('2026-08-13T12:00:00'), now)).toBe('13 Aug')
    })

    test('includes the year when an auto-postpone date falls in another year', () => {
        expect(formatDueDate(moment('2027-07-14T12:00:00'), now)).toBe('14 Jul 2027')
    })
})
