const moment = require('moment-timezone')

const {
    GOAL_MILESTONES_CADENCE_BIWEEKLY,
    GOAL_MILESTONES_CADENCE_MONTHLY,
    GOAL_MILESTONES_CADENCE_QUARTERLY,
    GOAL_MILESTONES_CADENCE_WEEKLY,
    GOAL_MILESTONES_MODE_MANUAL,
    GOAL_SCHEDULE_MODE_FIXED,
    MILESTONE_TYPE_FIXED,
    getLinearMilestonePeriod,
    getLinearMilestonePeriods,
    normalizeGoalMilestonesConfig,
    normalizeGoalScheduleMode,
    normalizeMilestoneType,
} = require('./goalMilestonesHelper')

describe('goalMilestonesHelper', () => {
    test('normalizes project, goal, and milestone defaults', () => {
        const defaultDate = Date.UTC(2026, 0, 1, 12)

        expect(normalizeGoalMilestonesConfig({}, 'Europe/Berlin', defaultDate)).toEqual({
            mode: GOAL_MILESTONES_MODE_MANUAL,
            cadence: GOAL_MILESTONES_CADENCE_WEEKLY,
            timezone: 'Europe/Berlin',
            cadenceStartDate: defaultDate,
            futureMilestonesToCreate: 3,
        })
        expect(normalizeGoalScheduleMode(undefined)).toBe(GOAL_SCHEDULE_MODE_FIXED)
        expect(normalizeMilestoneType(undefined)).toBe(MILESTONE_TYPE_FIXED)
    })

    test('calculates weekly periods from Monday in the project timezone', () => {
        const timestamp = moment.tz('2026-03-11 10:00', 'Europe/Berlin').valueOf()
        const period = getLinearMilestonePeriod(timestamp, {
            cadence: GOAL_MILESTONES_CADENCE_WEEKLY,
            timezone: 'Europe/Berlin',
            cadenceStartDate: timestamp,
        })

        expect(moment.tz(period.periodStartDate, 'Europe/Berlin').format()).toBe('2026-03-09T00:00:00+01:00')
        expect(moment.tz(period.periodEndDate, 'Europe/Berlin').format()).toBe('2026-03-15T23:59:59+01:00')
        expect(moment.tz(period.date, 'Europe/Berlin').format('YYYY-MM-DD HH:mm')).toBe('2026-03-15 12:00')
        expect(period.periodKey).toBe('weekly:2026-03-09')
    })

    test('anchors bi-weekly periods to the cadence start week', () => {
        const anchor = moment.tz('2026-06-03 12:00', 'UTC').valueOf()
        const firstPeriod = getLinearMilestonePeriod(moment.tz('2026-06-14 12:00', 'UTC').valueOf(), {
            cadence: GOAL_MILESTONES_CADENCE_BIWEEKLY,
            timezone: 'UTC',
            cadenceStartDate: anchor,
        })
        const secondPeriod = getLinearMilestonePeriod(moment.tz('2026-06-15 12:00', 'UTC').valueOf(), {
            cadence: GOAL_MILESTONES_CADENCE_BIWEEKLY,
            timezone: 'UTC',
            cadenceStartDate: anchor,
        })

        expect(firstPeriod.periodKey).toBe('biweekly:2026-06-01')
        expect(secondPeriod.periodKey).toBe('biweekly:2026-06-15')
    })

    test('handles monthly DST boundaries in the project timezone', () => {
        const timestamp = moment.tz('2026-03-29 10:00', 'Europe/Berlin').valueOf()
        const period = getLinearMilestonePeriod(timestamp, {
            cadence: GOAL_MILESTONES_CADENCE_MONTHLY,
            timezone: 'Europe/Berlin',
            cadenceStartDate: timestamp,
        })

        expect(moment.tz(period.periodStartDate, 'Europe/Berlin').format()).toBe('2026-03-01T00:00:00+01:00')
        expect(moment.tz(period.periodEndDate, 'Europe/Berlin').format()).toBe('2026-03-31T23:59:59+02:00')
        expect(moment.tz(period.date, 'Europe/Berlin').format('YYYY-MM-DD HH:mm')).toBe('2026-03-31 12:00')
    })

    test('creates current plus configured future quarterly periods', () => {
        const timestamp = moment.tz('2026-05-10 12:00', 'UTC').valueOf()
        const periods = getLinearMilestonePeriods(
            {
                cadence: GOAL_MILESTONES_CADENCE_QUARTERLY,
                timezone: 'UTC',
                cadenceStartDate: timestamp,
                futureMilestonesToCreate: 3,
            },
            timestamp,
            4
        )

        expect(periods.map(period => period.periodKey)).toEqual([
            'quarterly:2026-04-01',
            'quarterly:2026-07-01',
            'quarterly:2026-10-01',
            'quarterly:2027-01-01',
        ])
    })
})
