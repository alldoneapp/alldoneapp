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
