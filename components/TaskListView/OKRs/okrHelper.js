import moment from 'moment'

export const OKR_CADENCE_WEEKLY = 'weekly'
export const OKR_CADENCE_MONTHLY = 'monthly'
export const OKR_CADENCE_QUARTERLY = 'quarterly'

export const OKR_STATUS_ACTIVE = 'active'
export const OKR_STATUS_CLOSED = 'closed'

export const OKR_TYPE_MANUAL = 'manual'
export const OKR_TYPE_TIME_LOGGED_REVENUE = 'timeLoggedRevenue'

export const OKR_PACE_COMPLETED = 'completed'
export const OKR_PACE_AHEAD = 'ahead'
export const OKR_PACE_ON_TRACK = 'onTrack'
export const OKR_PACE_AT_RISK = 'atRisk'
export const OKR_PACE_OFF_TRACK = 'offTrack'
export const OKR_PACE_ENDED = 'ended'

export const OKR_CADENCES = [OKR_CADENCE_WEEKLY, OKR_CADENCE_MONTHLY, OKR_CADENCE_QUARTERLY]
export const OKR_TYPES = [OKR_TYPE_MANUAL, OKR_TYPE_TIME_LOGGED_REVENUE]

export function normalizeOkrNumber(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
}

export function normalizeOkrType(type) {
    return OKR_TYPES.includes(type) ? type : OKR_TYPE_MANUAL
}

export function getOkrAllProjectsTodayKey(timestamp = Date.now()) {
    return moment(timestamp).format('YYYY-MM-DD')
}

export function isRevenueOkr(okr) {
    return normalizeOkrType(okr?.type) === OKR_TYPE_TIME_LOGGED_REVENUE
}

export function calculateRevenueOkrCurrentValue(doneTimeMinutes, hourlyRate) {
    const minutes = normalizeOkrNumber(doneTimeMinutes)
    const rate = normalizeOkrNumber(hourlyRate)
    if (minutes <= 0 || rate <= 0) return 0
    return Number(((minutes / 60) * rate).toFixed(2))
}

export function resolveOkrCurrentValue(okr, revenueCurrentValue) {
    return isRevenueOkr(okr) ? normalizeOkrNumber(revenueCurrentValue) : normalizeOkrNumber(okr?.currentValue)
}

export function resolveOkrProgress(okr, revenueCurrentValue) {
    return calculateOkrProgress(resolveOkrCurrentValue(okr, revenueCurrentValue), okr?.targetValue)
}

export function calculateOkrProgress(currentValue, targetValue) {
    const current = normalizeOkrNumber(currentValue)
    const target = normalizeOkrNumber(targetValue)
    if (target <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
}

export function clampOkrPercent(value) {
    const number = normalizeOkrNumber(value)
    return Math.max(0, Math.min(100, number))
}

export function calculateOkrPace(okr, now = Date.now()) {
    const actualPercent = calculateOkrProgress(resolveOkrCurrentValue(okr, okr?.resolvedCurrentValue), okr.targetValue)
    const periodStart = normalizeOkrNumber(okr.periodStart)
    const periodEnd = normalizeOkrNumber(okr.periodEnd)
    const duration = periodEnd - periodStart
    const expectedPercent =
        duration > 0 ? clampOkrPercent(((now - periodStart) / duration) * 100) : now >= periodEnd ? 100 : 0
    const roundedExpectedPercent = Math.round(expectedPercent)
    const delta = actualPercent - roundedExpectedPercent

    if (actualPercent >= 100) {
        return {
            actualPercent,
            expectedPercent: roundedExpectedPercent,
            delta,
            status: OKR_PACE_COMPLETED,
            textKey: 'OKR pace completed',
        }
    }

    if (now >= periodEnd) {
        return {
            actualPercent,
            expectedPercent: roundedExpectedPercent,
            delta,
            status: OKR_PACE_ENDED,
            textKey: 'OKR pace ended',
        }
    }

    if (delta >= 10) {
        return {
            actualPercent,
            expectedPercent: roundedExpectedPercent,
            delta,
            status: OKR_PACE_AHEAD,
            textKey: 'OKR pace ahead',
        }
    }

    if (delta >= -5) {
        return {
            actualPercent,
            expectedPercent: roundedExpectedPercent,
            delta,
            status: OKR_PACE_ON_TRACK,
            textKey: 'OKR pace on track',
        }
    }

    if (delta >= -20) {
        return {
            actualPercent,
            expectedPercent: roundedExpectedPercent,
            delta,
            status: OKR_PACE_AT_RISK,
            textKey: 'OKR pace at risk',
        }
    }

    return {
        actualPercent,
        expectedPercent: roundedExpectedPercent,
        delta,
        status: OKR_PACE_OFF_TRACK,
        textKey: 'OKR pace off track',
    }
}

export function getOkrPeriodForCadence(cadence, timestamp = Date.now()) {
    const date = moment(timestamp)

    if (cadence === OKR_CADENCE_WEEKLY) {
        return {
            periodStart: date.clone().startOf('isoWeek').valueOf(),
            periodEnd: date.clone().endOf('isoWeek').valueOf(),
        }
    }

    if (cadence === OKR_CADENCE_QUARTERLY) {
        return {
            periodStart: date.clone().startOf('quarter').valueOf(),
            periodEnd: date.clone().endOf('quarter').valueOf(),
        }
    }

    return {
        periodStart: date.clone().startOf('month').valueOf(),
        periodEnd: date.clone().endOf('month').valueOf(),
    }
}

export function getOkrTimeLeftParts(periodEnd, now = Date.now()) {
    const remaining = normalizeOkrNumber(periodEnd) - now
    if (remaining <= 0) {
        return { textKey: 'OKR period ended', interpolations: {} }
    }

    const days = Math.ceil(remaining / 86400000)
    if (days > 1) {
        return { textKey: 'OKR days left', interpolations: { days } }
    }

    const hours = Math.max(1, Math.ceil(remaining / 3600000))
    return { textKey: 'OKR hours left', interpolations: { hours } }
}

export function formatOkrValue(value, unit) {
    const number = normalizeOkrNumber(value)
    const formattedNumber = Number.isInteger(number) ? `${number}` : `${number.toFixed(2).replace(/\.?0+$/, '')}`
    const cleanUnit = typeof unit === 'string' ? unit.trim() : ''
    return cleanUnit ? `${formattedNumber} ${cleanUnit}` : formattedNumber
}
