import moment from 'moment-timezone'

export const GOAL_MILESTONES_MODE_MANUAL = 'manual'
export const GOAL_MILESTONES_MODE_LINEAR = 'linear'

export const GOAL_MILESTONES_CADENCE_WEEKLY = 'weekly'
export const GOAL_MILESTONES_CADENCE_BIWEEKLY = 'biweekly'
export const GOAL_MILESTONES_CADENCE_MONTHLY = 'monthly'
export const GOAL_MILESTONES_CADENCE_QUARTERLY = 'quarterly'

export const GOAL_SCHEDULE_MODE_FIXED = 'fixed'
export const GOAL_SCHEDULE_MODE_DYNAMIC = 'dynamic'

export const MILESTONE_TYPE_FIXED = 'fixed'
export const MILESTONE_TYPE_LINEAR = 'linear'

export const DEFAULT_FUTURE_LINEAR_MILESTONES_TO_CREATE = 3

const VALID_CADENCES = [
    GOAL_MILESTONES_CADENCE_WEEKLY,
    GOAL_MILESTONES_CADENCE_BIWEEKLY,
    GOAL_MILESTONES_CADENCE_MONTHLY,
    GOAL_MILESTONES_CADENCE_QUARTERLY,
]

export function getCurrentTimezone() {
    return moment.tz.guess() || 'UTC'
}

export function normalizeGoalMilestonesConfig(
    config = {},
    fallbackTimezone = getCurrentTimezone(),
    defaultDate = Date.now()
) {
    const mode = config.mode === GOAL_MILESTONES_MODE_LINEAR ? GOAL_MILESTONES_MODE_LINEAR : GOAL_MILESTONES_MODE_MANUAL
    const cadence = VALID_CADENCES.includes(config.cadence) ? config.cadence : GOAL_MILESTONES_CADENCE_WEEKLY
    const timezone =
        typeof config.timezone === 'string' && moment.tz.zone(config.timezone) ? config.timezone : fallbackTimezone
    const cadenceStartDate = Number.isFinite(Number(config.cadenceStartDate))
        ? Number(config.cadenceStartDate)
        : defaultDate
    const futureMilestonesToCreate = Number.isFinite(Number(config.futureMilestonesToCreate))
        ? Math.max(1, Number(config.futureMilestonesToCreate))
        : DEFAULT_FUTURE_LINEAR_MILESTONES_TO_CREATE

    return {
        mode,
        cadence,
        timezone,
        cadenceStartDate,
        futureMilestonesToCreate,
    }
}

export function isLinearGoalMilestonesConfig(config) {
    return normalizeGoalMilestonesConfig(config).mode === GOAL_MILESTONES_MODE_LINEAR
}

export function normalizeGoalScheduleMode(scheduleMode) {
    return scheduleMode === GOAL_SCHEDULE_MODE_DYNAMIC ? GOAL_SCHEDULE_MODE_DYNAMIC : GOAL_SCHEDULE_MODE_FIXED
}

export function normalizeMilestoneType(milestoneType) {
    return milestoneType === MILESTONE_TYPE_LINEAR ? MILESTONE_TYPE_LINEAR : MILESTONE_TYPE_FIXED
}

function getPeriodStartForTimestamp(timestamp, config) {
    const normalizedConfig = normalizeGoalMilestonesConfig(config)
    const date = moment.tz(timestamp, normalizedConfig.timezone)

    if (normalizedConfig.cadence === GOAL_MILESTONES_CADENCE_MONTHLY) {
        return date.clone().startOf('month')
    }

    if (normalizedConfig.cadence === GOAL_MILESTONES_CADENCE_QUARTERLY) {
        return date.clone().startOf('quarter')
    }

    const weekStart = date.clone().startOf('isoWeek')

    if (normalizedConfig.cadence === GOAL_MILESTONES_CADENCE_BIWEEKLY) {
        const anchor = moment.tz(normalizedConfig.cadenceStartDate, normalizedConfig.timezone).startOf('isoWeek')
        const diffWeeks = weekStart.diff(anchor, 'weeks')
        const periodOffset = Math.floor(diffWeeks / 2) * 2
        return anchor.clone().add(periodOffset, 'weeks')
    }

    return weekStart
}

function getPeriodEndFromStart(periodStart, cadence) {
    if (cadence === GOAL_MILESTONES_CADENCE_MONTHLY) return periodStart.clone().endOf('month')
    if (cadence === GOAL_MILESTONES_CADENCE_QUARTERLY) return periodStart.clone().endOf('quarter')
    if (cadence === GOAL_MILESTONES_CADENCE_BIWEEKLY)
        return periodStart.clone().add(2, 'weeks').subtract(1, 'millisecond')
    return periodStart.clone().add(1, 'week').subtract(1, 'millisecond')
}

function addPeriod(periodStart, cadence, amount = 1) {
    if (cadence === GOAL_MILESTONES_CADENCE_MONTHLY) return periodStart.clone().add(amount, 'months')
    if (cadence === GOAL_MILESTONES_CADENCE_QUARTERLY) return periodStart.clone().add(amount, 'quarters')
    if (cadence === GOAL_MILESTONES_CADENCE_BIWEEKLY) return periodStart.clone().add(amount * 2, 'weeks')
    return periodStart.clone().add(amount, 'weeks')
}

export function getLinearMilestonePeriod(timestamp, config) {
    const normalizedConfig = normalizeGoalMilestonesConfig(config)
    const periodStart = getPeriodStartForTimestamp(timestamp, normalizedConfig)
    const periodEnd = getPeriodEndFromStart(periodStart, normalizedConfig.cadence)
    const milestoneDate = periodEnd.clone().startOf('day').hour(12).minute(0).second(0).millisecond(0)

    return {
        cadence: normalizedConfig.cadence,
        timezone: normalizedConfig.timezone,
        periodStartDate: periodStart.valueOf(),
        periodEndDate: periodEnd.valueOf(),
        date: milestoneDate.valueOf(),
        periodKey: `${normalizedConfig.cadence}:${periodStart.format('YYYY-MM-DD')}`,
    }
}

export function getLinearMilestonePeriods(config, startTimestamp = Date.now(), amount = 4) {
    const normalizedConfig = normalizeGoalMilestonesConfig(config)
    let cursor = getPeriodStartForTimestamp(startTimestamp, normalizedConfig)
    const periods = []

    for (let i = 0; i < amount; i++) {
        periods.push(getLinearMilestonePeriod(cursor.valueOf(), normalizedConfig))
        cursor = addPeriod(cursor, normalizedConfig.cadence, 1)
    }

    return periods
}

export function getLinearMilestoneTitle(period) {
    const start = moment.tz(period.periodStartDate, period.timezone)
    const end = moment.tz(period.periodEndDate, period.timezone)
    return `${start.format('D MMM')} - ${end.format('D MMM YYYY')}`
}
