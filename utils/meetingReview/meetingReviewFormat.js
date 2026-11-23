import moment from 'moment'

import { localizedMoment } from '../../i18n/localizedMoment'

/**
 * AT-3137 — periods and number formats of the meeting time statistics.
 *
 * Periods are computed in the device's local timezone with moment, like every other date in the
 * task lists (so DST days are 23 or 25 hours long, and the week runs Monday to Sunday). The pure
 * statistics module receives the resulting boundaries and never guesses a timezone itself.
 */

export const MEETING_STATS_PERIOD_DAY = 'day'
export const MEETING_STATS_PERIOD_WEEK = 'week'
export const MEETING_STATS_PERIOD_MONTH = 'month'
export const MEETING_STATS_PERIODS = [MEETING_STATS_PERIOD_DAY, MEETING_STATS_PERIOD_WEEK, MEETING_STATS_PERIOD_MONTH]

const MOMENT_UNIT = {
    [MEETING_STATS_PERIOD_DAY]: 'day',
    [MEETING_STATS_PERIOD_WEEK]: 'isoWeek',
    [MEETING_STATS_PERIOD_MONTH]: 'month',
}
const ADD_UNIT = {
    [MEETING_STATS_PERIOD_DAY]: 'day',
    [MEETING_STATS_PERIOD_WEEK]: 'week',
    [MEETING_STATS_PERIOD_MONTH]: 'month',
}

/**
 * @returns {{period:string, startMs:number, endMs:number, dayStartsMs:number[]}}
 */
export const getMeetingStatsRange = (period, anchorMs = Date.now()) => {
    const unit = MOMENT_UNIT[period] || 'isoWeek'
    const start = moment(anchorMs).startOf(unit)
    const end = start.clone().add(1, ADD_UNIT[period] || 'week')
    const dayStartsMs = []
    const cursor = start.clone()
    while (cursor.isBefore(end)) {
        dayStartsMs.push(cursor.valueOf())
        cursor.add(1, 'day').startOf('day')
    }
    return { period, startMs: start.valueOf(), endMs: end.valueOf(), dayStartsMs }
}

export const shiftMeetingStatsAnchor = (period, anchorMs, delta) =>
    moment(anchorMs)
        .add(delta, ADD_UNIT[period] || 'week')
        .valueOf()

export const getMeetingStatsRangeLabel = (range, dateFormat = 'DD.MM.YYYY') => {
    const start = localizedMoment(range.startMs)
    const lastDay = localizedMoment(range.endMs - 1)
    switch (range.period) {
        case MEETING_STATS_PERIOD_DAY:
            return `${start.format('dd')} ${start.format(dateFormat)}`
        case MEETING_STATS_PERIOD_MONTH:
            return start.format('MMMM YYYY')
        default:
            return `${start.isoWeek()} · ${start.format(dateFormat)} – ${lastDay.format(dateFormat)}`
    }
}

/** 7 h 15 (concept wireframes). Rounds to whole minutes. */
export const formatMeetingHours = ms => {
    const totalMinutes = Math.max(0, Math.round((Number(ms) || 0) / 60000))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return `${hours} h ${String(minutes).padStart(2, '0')}`
}

/** 45 min; switches to hours from 2 hours on. */
export const formatMeetingDuration = ms => {
    const totalMinutes = Math.max(0, Math.round((Number(ms) || 0) / 60000))
    return totalMinutes >= 120 ? formatMeetingHours(ms) : `${totalMinutes} min`
}

export const formatMeetingTime = (ms, timeFormat = 'HH:mm') => moment(ms).format(timeFormat)
