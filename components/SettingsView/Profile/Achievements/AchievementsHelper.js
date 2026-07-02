import moment from 'moment'

export const EMPTY_INBOX_DATE_FORMAT = 'YYYY-MM-DD'

export const normalizeEmptyInboxDays = emptyInboxDays => {
    const uniqueDays = new Set()

    if (Array.isArray(emptyInboxDays)) {
        emptyInboxDays.forEach(day => {
            const normalizedDay = moment(day, EMPTY_INBOX_DATE_FORMAT, true)
            if (normalizedDay.isValid()) uniqueDays.add(normalizedDay.format(EMPTY_INBOX_DATE_FORMAT))
        })
    }

    return Array.from(uniqueDays).sort()
}

export const getEmptyInboxDaysWithLegacyFallback = user => {
    if (Array.isArray(user.emptyInboxDays)) return normalizeEmptyInboxDays(user.emptyInboxDays)
    if (!user.lastDayEmptyInbox) return []

    return [moment(user.lastDayEmptyInbox).format(EMPTY_INBOX_DATE_FORMAT)]
}

export const getEmptyInboxAchievementStats = (emptyInboxDays, todayTimestamp = Date.now()) => {
    const today = moment(todayTimestamp).startOf('day')
    const todayKey = today.format(EMPTY_INBOX_DATE_FORMAT)
    const days = normalizeEmptyInboxDays(emptyInboxDays).filter(day => day <= todayKey)
    const daysSet = new Set(days)
    let longestStreak = 0
    let runningStreak = 0
    let previousDay = null

    days.forEach(day => {
        const currentDay = moment(day, EMPTY_INBOX_DATE_FORMAT, true)
        runningStreak = previousDay && currentDay.diff(previousDay, 'days') === 1 ? runningStreak + 1 : 1
        longestStreak = Math.max(longestStreak, runningStreak)
        previousDay = currentDay
    })

    let currentStreak = 0
    let streakDay = today.clone()

    if (!daysSet.has(todayKey)) streakDay.subtract(1, 'day')

    while (daysSet.has(streakDay.format(EMPTY_INBOX_DATE_FORMAT))) {
        currentStreak += 1
        streakDay.subtract(1, 'day')
    }

    return {
        currentStreak,
        longestStreak,
        totalDays: days.length,
    }
}

export const buildEmptyInboxActivityWeeks = (emptyInboxDays, numberOfWeeks, todayTimestamp = Date.now()) => {
    const today = moment(todayTimestamp).startOf('day')
    const achievedDays = new Set(normalizeEmptyInboxDays(emptyInboxDays))
    const endDate = today.clone().endOf('isoWeek')
    const startDate = endDate
        .clone()
        .subtract(numberOfWeeks - 1, 'weeks')
        .startOf('isoWeek')

    return Array.from({ length: numberOfWeeks }, (_, weekIndex) => {
        const weekStart = startDate.clone().add(weekIndex, 'weeks')
        const days = Array.from({ length: 7 }, (_, dayIndex) => {
            const date = weekStart.clone().add(dayIndex, 'days')
            const dateKey = date.format(EMPTY_INBOX_DATE_FORMAT)

            return {
                achieved: achievedDays.has(dateKey) && !date.isAfter(today, 'day'),
                date,
                dateKey,
                isFuture: date.isAfter(today, 'day'),
                isToday: date.isSame(today, 'day'),
            }
        })
        const firstDayOfMonth = days.find(day => day.date.date() === 1)

        return {
            days,
            monthName:
                weekIndex === 0 ? weekStart.format('MMMM') : firstDayOfMonth ? firstDayOfMonth.date.format('MMMM') : '',
        }
    })
}
