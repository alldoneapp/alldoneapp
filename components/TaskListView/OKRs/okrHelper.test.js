import moment from 'moment'

import {
    OKR_CADENCE_MONTHLY,
    OKR_CADENCE_QUARTERLY,
    OKR_CADENCE_WEEKLY,
    OKR_PACE_AHEAD,
    OKR_PACE_AT_RISK,
    OKR_PACE_COMPLETED,
    OKR_PACE_ENDED,
    OKR_PACE_OFF_TRACK,
    OKR_PACE_ON_TRACK,
    OKR_TYPE_MANUAL,
    OKR_TYPE_TIME_LOGGED_REVENUE,
    calculateRevenueOkrCurrentValue,
    calculateOkrPace,
    calculateOkrProgress,
    getOkrAllProjectsTodayKey,
    getOkrPeriodForCadence,
    normalizeOkrType,
    resolveOkrProgress,
} from './okrHelper'

describe('okrHelper', () => {
    test('clamps progress between 0 and 100', () => {
        expect(calculateOkrProgress(5, 10)).toBe(50)
        expect(calculateOkrProgress(15, 10)).toBe(100)
        expect(calculateOkrProgress(-5, 10)).toBe(0)
        expect(calculateOkrProgress(10, 0)).toBe(0)
    })

    test('defaults missing OKR type to manual', () => {
        expect(normalizeOkrType()).toBe(OKR_TYPE_MANUAL)
        expect(normalizeOkrType(OKR_TYPE_TIME_LOGGED_REVENUE)).toBe(OKR_TYPE_TIME_LOGGED_REVENUE)
        expect(normalizeOkrType('other')).toBe(OKR_TYPE_MANUAL)
    })

    test('formats all-projects OKR done-for-today key', () => {
        expect(getOkrAllProjectsTodayKey(moment('2026-05-12T08:00:00.000Z').valueOf())).toBe('2026-05-12')
    })

    test('calculates revenue OKR current value from minutes and hourly rate', () => {
        expect(calculateRevenueOkrCurrentValue(90, 100)).toBe(150)
        expect(calculateRevenueOkrCurrentValue(45, 80)).toBe(60)
        expect(calculateRevenueOkrCurrentValue(120, 0)).toBe(0)
        expect(calculateRevenueOkrCurrentValue(120, undefined)).toBe(0)
    })

    test('uses derived revenue value for progress and stored value for manual OKRs', () => {
        expect(resolveOkrProgress({ type: OKR_TYPE_TIME_LOGGED_REVENUE, currentValue: 0, targetValue: 200 }, 100)).toBe(
            50
        )
        expect(resolveOkrProgress({ currentValue: 25, targetValue: 100 }, 100)).toBe(25)
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

    test('calculates expected linear progress and clamps elapsed time', () => {
        const okr = { currentValue: 25, targetValue: 100, periodStart: 1000, periodEnd: 2000 }

        expect(calculateOkrPace(okr, 500)).toMatchObject({
            actualPercent: 25,
            expectedPercent: 0,
            delta: 25,
            status: OKR_PACE_AHEAD,
        })
        expect(calculateOkrPace(okr, 1500)).toMatchObject({
            actualPercent: 25,
            expectedPercent: 50,
            delta: -25,
            status: OKR_PACE_OFF_TRACK,
        })
        expect(calculateOkrPace(okr, 2500)).toMatchObject({
            actualPercent: 25,
            expectedPercent: 100,
            delta: -75,
            status: OKR_PACE_ENDED,
        })
    })

    test('classifies OKR pace at status thresholds', () => {
        const base = { targetValue: 100, periodStart: 0, periodEnd: 1000 }

        expect(calculateOkrPace({ ...base, currentValue: 100 }, 500).status).toBe(OKR_PACE_COMPLETED)
        expect(calculateOkrPace({ ...base, currentValue: 60 }, 500).status).toBe(OKR_PACE_AHEAD)
        expect(calculateOkrPace({ ...base, currentValue: 45 }, 500).status).toBe(OKR_PACE_ON_TRACK)
        expect(calculateOkrPace({ ...base, currentValue: 30 }, 500).status).toBe(OKR_PACE_AT_RISK)
        expect(calculateOkrPace({ ...base, currentValue: 29 }, 500).status).toBe(OKR_PACE_OFF_TRACK)
    })

    test('handles invalid period length safely', () => {
        expect(
            calculateOkrPace({ currentValue: 0, targetValue: 10, periodStart: 1000, periodEnd: 1000 }, 999)
        ).toMatchObject({
            expectedPercent: 0,
            status: OKR_PACE_ON_TRACK,
        })
        expect(
            calculateOkrPace({ currentValue: 0, targetValue: 10, periodStart: 1000, periodEnd: 1000 }, 1000)
        ).toMatchObject({
            expectedPercent: 100,
            status: OKR_PACE_ENDED,
        })
    })
})
