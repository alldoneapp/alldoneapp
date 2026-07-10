import moment from 'moment'
import { needToAcknowledgeNewDay } from '../../utils/NewDayModalHelper'

describe('NewDayModalHelper', () => {
    const now = moment('2026-07-10T13:50:00').valueOf()
    const today = moment('2026-07-10T09:00:00').valueOf()
    const yesterday = moment('2026-07-09T22:00:00').valueOf()

    describe('needToAcknowledgeNewDay', () => {
        it('is true when the last acknowledgement was a previous day', () => {
            // The user last confirmed yesterday -> a new day must be acknowledged.
            expect(needToAcknowledgeNewDay(yesterday, now)).toBe(true)
        })

        it('is false when the day was already acknowledged today', () => {
            // Confirmed earlier today (possibly synced in from another device)
            // -> nothing left to confirm, so the modal must stay closed.
            expect(needToAcknowledgeNewDay(today, now)).toBe(false)
        })

        it('is false when the acknowledgement is later the same day', () => {
            const laterToday = moment('2026-07-10T18:00:00').valueOf()
            expect(needToAcknowledgeNewDay(laterToday, now)).toBe(false)
        })

        it('is true across a month boundary', () => {
            const lastMonth = moment('2026-06-30T23:30:00').valueOf()
            const firstOfMonth = moment('2026-07-01T00:10:00').valueOf()
            expect(needToAcknowledgeNewDay(lastMonth, firstOfMonth)).toBe(true)
        })

        it('defaults now to the current time when omitted', () => {
            // A far-past acknowledgement is always a new day relative to "now".
            const longAgo = moment('2000-01-01T00:00:00').valueOf()
            expect(needToAcknowledgeNewDay(longAgo)).toBe(true)
        })
    })
})
