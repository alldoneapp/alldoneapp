import moment from 'moment'
import { getDateFormat } from '../components/UIComponents/FloatModals/DateFormatPickerModal'

export const HAPPINESS_EMOJIS = {
    1: '😞',
    2: '🙁',
    3: '😐',
    4: '🙂',
    5: '😄',
}

export const HAPPINESS_SCALE = [1, 2, 3, 4, 5]

export const HAPPINESS_PRIVACY_TEXT = 'Only you can see these ratings and notes.'

export const HAPPINESS_RANGE_LAST_30_DAYS = 'Last 30 days'
export const HAPPINESS_RANGE_LAST_3_MONTHS = 'Last 3 months'
export const HAPPINESS_RANGE_LAST_12_MONTHS = 'Last 12 months'
export const HAPPINESS_RANGE_LAST_YEAR = 'Last year'
export const HAPPINESS_RANGE_CURRENT_YEAR = 'Current year'
// Custom range reuses the shared 'Custom' filter value produced by CustomDateRangeModal
export const HAPPINESS_RANGE_CUSTOM = 'Custom'

export const getHappinessRangeTimestamps = filterData => {
    const { filter, customDateRange } = filterData
    let startDay, endDay

    switch (filter) {
        case HAPPINESS_RANGE_LAST_3_MONTHS:
            startDay = moment().subtract(3, 'months')
            endDay = moment()
            break
        case HAPPINESS_RANGE_LAST_12_MONTHS:
            startDay = moment().subtract(12, 'months')
            endDay = moment()
            break
        case HAPPINESS_RANGE_LAST_YEAR:
            startDay = moment().subtract(1, 'year').startOf('year')
            endDay = startDay.clone().endOf('year')
            break
        case HAPPINESS_RANGE_CURRENT_YEAR:
            startDay = moment().startOf('year')
            endDay = moment().endOf('year')
            break
        case HAPPINESS_RANGE_CUSTOM:
            startDay = moment(customDateRange[0])
            endDay = moment(customDateRange[customDateRange.length - 1])
            break
        case HAPPINESS_RANGE_LAST_30_DAYS:
        default:
            startDay = moment().subtract(30, 'days')
            endDay = moment()
            break
    }

    return {
        timestamp1: startDay.startOf('day').valueOf(),
        timestamp2: endDay.endOf('day').valueOf(),
    }
}

export const getHappinessDateKey = date => moment(date).format('YYYYMMDD')

export const getHappinessDay = date => parseInt(moment(date).format('YYYYMMDD'))

export const getHappinessTimestamp = date => moment(date).startOf('day').valueOf()

export const getHappinessDateText = timestamp => moment(timestamp).format(getDateFormat())

export const getHappinessRatingText = rating => (rating ? `${HAPPINESS_EMOJIS[rating]} ${rating}/5` : '')

export const normalizeHappinessEntries = entries =>
    entries.filter(entry => entry && entry.rating).sort((a, b) => b.timestamp - a.timestamp)

export const getHappinessStats = entries => {
    const ratedEntries = normalizeHappinessEntries(entries)
    const trackedDays = ratedEntries.length
    const latest = ratedEntries[0] || null
    const distribution = HAPPINESS_SCALE.reduce((acc, rating) => ({ ...acc, [rating]: 0 }), {})
    const total = ratedEntries.reduce((sum, entry) => {
        distribution[entry.rating] = (distribution[entry.rating] || 0) + 1
        return sum + entry.rating
    }, 0)

    return {
        average: trackedDays ? total / trackedDays : 0,
        latest,
        trackedDays,
        distribution,
    }
}

export const getHappinessChartData = entries =>
    normalizeHappinessEntries(entries).reduce((acc, entry) => {
        acc[entry.timestamp] = entry.rating
        return acc
    }, {})

export const getGlobalHappinessStats = happinessByProject => {
    const projectStats = Object.entries(happinessByProject).reduce((acc, [projectId, entries]) => {
        const stats = getHappinessStats(entries)
        if (stats.trackedDays > 0) acc[projectId] = stats
        return acc
    }, {})
    const statsList = Object.values(projectStats)
    const average = statsList.length ? statsList.reduce((sum, stats) => sum + stats.average, 0) / statsList.length : 0
    const trackedDays = statsList.reduce((sum, stats) => sum + stats.trackedDays, 0)
    const distribution = statsList.reduce(
        (acc, stats) => {
            HAPPINESS_SCALE.forEach(rating => {
                acc[rating] = (acc[rating] || 0) + (stats.distribution[rating] || 0)
            })
            return acc
        },
        HAPPINESS_SCALE.reduce((acc, rating) => ({ ...acc, [rating]: 0 }), {})
    )

    return {
        average,
        trackedDays,
        distribution,
        projectStats,
        projectsTracked: statsList.length,
    }
}
