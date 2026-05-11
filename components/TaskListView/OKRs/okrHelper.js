import moment from 'moment'

export const OKR_CADENCE_WEEKLY = 'weekly'
export const OKR_CADENCE_MONTHLY = 'monthly'
export const OKR_CADENCE_QUARTERLY = 'quarterly'

export const OKR_STATUS_ACTIVE = 'active'
export const OKR_STATUS_CLOSED = 'closed'

export const OKR_CADENCES = [OKR_CADENCE_WEEKLY, OKR_CADENCE_MONTHLY, OKR_CADENCE_QUARTERLY]

export function normalizeOkrNumber(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
}

export function calculateOkrProgress(currentValue, targetValue) {
    const current = normalizeOkrNumber(currentValue)
    const target = normalizeOkrNumber(targetValue)
    if (target <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
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
