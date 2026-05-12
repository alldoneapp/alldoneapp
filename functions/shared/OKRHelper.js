'use strict'

const moment = require('moment-timezone')

const OKRS_COLLECTION = 'projectOkrs'
const OKR_STATUS_ACTIVE = 'active'
const OKR_STATUS_CLOSED = 'closed'
const OKR_CADENCE_WEEKLY = 'weekly'
const OKR_CADENCE_MONTHLY = 'monthly'
const OKR_CADENCE_QUARTERLY = 'quarterly'
const OKR_TYPE_MANUAL = 'manual'
const OKR_TYPE_TIME_LOGGED_REVENUE = 'timeLoggedRevenue'
const VALID_OKR_STATUSES = [OKR_STATUS_ACTIVE, OKR_STATUS_CLOSED, 'all']
const VALID_OKR_TYPES = [OKR_TYPE_MANUAL, OKR_TYPE_TIME_LOGGED_REVENUE]
const ESTIMATION_TYPE_TIME = 'TIME'

function normalizeOkrNumber(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
}

function calculateOkrProgress(currentValue, targetValue) {
    const current = normalizeOkrNumber(currentValue)
    const target = normalizeOkrNumber(targetValue)
    if (target <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((current / target) * 100)))
}

function normalizeOkrType(type) {
    return VALID_OKR_TYPES.includes(type) ? type : OKR_TYPE_MANUAL
}

function isRevenueOkr(okr = {}) {
    return normalizeOkrType(okr.type) === OKR_TYPE_TIME_LOGGED_REVENUE
}

function calculateRevenueOkrCurrentValue(doneTimeMinutes, hourlyRate) {
    const minutes = normalizeOkrNumber(doneTimeMinutes)
    const rate = normalizeOkrNumber(hourlyRate)
    if (minutes <= 0 || rate <= 0) return 0
    return Number(((minutes / 60) * rate).toFixed(2))
}

function getProjectCurrency(project = {}) {
    return project?.hourlyRatesData?.currency || 'EUR'
}

function getOwnerHourlyRate(project = {}, ownerId) {
    return normalizeOkrNumber(project?.hourlyRatesData?.hourlyRates?.[ownerId])
}

async function getDoneTimeMinutesForPeriod(db, project, ownerId, periodStart, periodEnd) {
    if (!db || !project?.id || !ownerId) return 0
    if ((project.estimationType || ESTIMATION_TYPE_TIME) !== ESTIMATION_TYPE_TIME) return 0

    const dayDate1 = parseInt(moment(periodStart).format('YYYYMMDD'))
    const dayDate2 = parseInt(moment(periodEnd).format('YYYYMMDD'))
    if (!Number.isFinite(dayDate1) || !Number.isFinite(dayDate2)) return 0

    const snapshot = await db
        .collection(`statistics/${project.id}/${ownerId}`)
        .where('day', '>=', dayDate1)
        .where('day', '<=', dayDate2)
        .get()

    return snapshot.docs.reduce((total, doc) => total + normalizeOkrNumber(doc.data()?.doneTime), 0)
}

async function resolveOkrDataForProject(db, project, okr) {
    const normalizedOkr = { ...okr, type: normalizeOkrType(okr?.type) }
    if (!isRevenueOkr(normalizedOkr)) return normalizedOkr

    const doneTimeMinutes = await getDoneTimeMinutesForPeriod(
        db,
        project,
        normalizedOkr.ownerId,
        normalizedOkr.periodStart,
        normalizedOkr.periodEnd
    )
    const currentValue = calculateRevenueOkrCurrentValue(
        doneTimeMinutes,
        getOwnerHourlyRate(project, normalizedOkr.ownerId)
    )
    return {
        ...normalizedOkr,
        currentValue,
        unit: normalizedOkr.unit || getProjectCurrency(project),
        progress: calculateOkrProgress(currentValue, normalizedOkr.targetValue),
    }
}

function getMomentForUser(userData = {}, timestamp = Date.now()) {
    const timezoneName =
        typeof userData.timezone === 'string' && moment.tz.zone(userData.timezone) ? userData.timezone : null
    if (timezoneName) return moment(timestamp).tz(timezoneName)

    const offset = normalizeOkrNumber(userData.timezone ?? userData.timezoneOffset ?? userData.timezoneMinutes, NaN)
    return Number.isFinite(offset) ? moment.utc(timestamp).utcOffset(offset) : moment.utc(timestamp)
}

function getOkrPeriodForCadence(cadence, timestamp = Date.now(), userData = {}) {
    const date = getMomentForUser(userData, timestamp)

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

function getNextOkrPeriod(cadence, periodEnd, userData = {}) {
    return getOkrPeriodForCadence(cadence, normalizeOkrNumber(periodEnd) + 1, userData)
}

function mapOKRData(okrId, okr = {}) {
    const currentValue = normalizeOkrNumber(okr.currentValue)
    const targetValue = normalizeOkrNumber(okr.targetValue)
    return {
        id: okr.id || okrId,
        objectType: 'okr',
        type: normalizeOkrType(okr.type),
        projectId: okr.projectId || '',
        ownerId: okr.ownerId || '',
        label: okr.label || '',
        currentValue,
        targetValue,
        unit: okr.unit || '',
        cadence: okr.cadence || OKR_CADENCE_MONTHLY,
        periodStart: normalizeOkrNumber(okr.periodStart),
        periodEnd: normalizeOkrNumber(okr.periodEnd),
        status: okr.status || OKR_STATUS_ACTIVE,
        previousOkrId: okr.previousOkrId || null,
        created: okr.created || Date.now(),
        creatorId: okr.creatorId || '',
        lastEditionDate: okr.lastEditionDate || Date.now(),
        lastEditorId: okr.lastEditorId || '',
        renewalProcessedAt: okr.renewalProcessedAt || null,
        progress: calculateOkrProgress(currentValue, targetValue),
    }
}

function normalizeStatus(status) {
    if (status === undefined || status === null || status === '') return OKR_STATUS_ACTIVE
    const normalized = String(status).trim().toLowerCase()
    if (!VALID_OKR_STATUSES.includes(normalized)) {
        throw new Error(`Invalid OKR status "${status}".`)
    }
    return normalized
}

function getRemainingText(periodEnd, now = Date.now()) {
    const remaining = normalizeOkrNumber(periodEnd) - now
    if (remaining <= 0) return 'period ended'
    const days = Math.ceil(remaining / 86400000)
    if (days > 1) return `${days} days left`
    return `${Math.max(1, Math.ceil(remaining / 3600000))} hours left`
}

module.exports = {
    OKRS_COLLECTION,
    OKR_STATUS_ACTIVE,
    OKR_STATUS_CLOSED,
    OKR_CADENCE_WEEKLY,
    OKR_CADENCE_MONTHLY,
    OKR_CADENCE_QUARTERLY,
    OKR_TYPE_MANUAL,
    OKR_TYPE_TIME_LOGGED_REVENUE,
    calculateOkrProgress,
    calculateRevenueOkrCurrentValue,
    getNextOkrPeriod,
    getOkrPeriodForCadence,
    getDoneTimeMinutesForPeriod,
    getRemainingText,
    getOwnerHourlyRate,
    getProjectCurrency,
    isRevenueOkr,
    mapOKRData,
    normalizeOkrNumber,
    normalizeOkrType,
    normalizeStatus,
    resolveOkrDataForProject,
}
