import moment from 'moment'

import {
    OKR_CADENCE_MONTHLY,
    OKR_CADENCE_QUARTERLY,
    OKR_CADENCE_WEEKLY,
    calculateOkrProgress,
    getOkrPeriodForCadence,
} from './okrHelper'

describe('okrHelper', () => {
    test('clamps progress between 0 and 100', () => {
        expect(calculateOkrProgress(5, 10)).toBe(50)
        expect(calculateOkrProgress(15, 10)).toBe(100)
        expect(calculateOkrProgress(-5, 10)).toBe(0)
        expect(calculateOkrProgress(10, 0)).toBe(0)
    })

    test('calculates weekly period using iso weeks', () => {
        const timestamp = moment('2026-05-13T12:00:00.000Z').valueOf()
        const period = getOkrPeriodForCadence(OKR_CADENCE_WEEKLY, timestamp)

        expect(moment(period.periodStart).isoWeekday()).toBe(1)
        expect(moment(period.periodEnd).isoWeekday()).toBe(7)
    })

    test('calculates monthly and quarterly periods', () => {
        const timestamp = moment('2026-05-13T12:00:00.000Z').valueOf()
        const monthly = getOkrPeriodForCadence(OKR_CADENCE_MONTHLY, timestamp)
        const quarterly = getOkrPeriodForCadence(OKR_CADENCE_QUARTERLY, timestamp)

        expect(moment(monthly.periodStart).date()).toBe(1)
        expect(moment(monthly.periodEnd).month()).toBe(4)
        expect(moment(quarterly.periodStart).month()).toBe(3)
        expect(moment(quarterly.periodEnd).month()).toBe(5)
    })
})
