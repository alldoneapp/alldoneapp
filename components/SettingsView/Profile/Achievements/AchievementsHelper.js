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

/**
 * AT-2461 — the millisecond timestamp at which the user FIRST reached empty inbox today, or `null`
 * when that moment is not known.
 *
 * There is no dedicated per-day time in the data model, and none is needed: `useReachEmptyInbox`
 * already writes `lastDayEmptyInbox` as a full `moment().valueOf()` the moment the all-projects task
 * count drops to zero, and it only writes it when the day is not yet recorded — so the field IS the
 * first inbox-zero moment of the day it falls on, which is exactly what the card wants to report.
 * `emptyInboxDays` deliberately keeps only `YYYY-MM-DD` keys, so it can say WHICH days but never
 * WHEN.
 *
 * Two guards, and both are load-bearing rather than defensive:
 *
 * - The timestamp must fall on the day being asked about. `lastDayEmptyInbox` is a running "last
 *   time" pointer, so on any day the inbox has not been cleared it holds an OLDER day's clock time —
 *   rendering it would report a time for a day that never happened.
 * - That day must also be present in the achievement days. A brand-new account is created with
 *   `lastDayEmptyInbox: dateNow` and `emptyInboxDays: []` (see `ContactsHelper.createUserData`), so
 *   the timestamp alone would congratulate somebody who has never cleared anything for signing up.
 *   Asking the achievement days keeps this answer consistent with the green cell and the streak,
 *   which are driven by the same array.
 *
 * Note the caller passes the ALREADY-RESOLVED days (`getEmptyInboxDaysWithLegacyFallback`), so a
 * legacy account whose history was never initialized still gets its one derived day and behaves the
 * same as the grid does for it.
 */
export const getTodayEmptyInboxTimestamp = (user, emptyInboxDays, todayTimestamp = Date.now()) => {
    const lastDayEmptyInbox = user ? user.lastDayEmptyInbox : null
    // `moment(undefined)` is NOW — i.e. always "today" — so nullish input must be rejected before it
    // ever reaches moment, or an account with no timestamp at all would report the current time.
    if (lastDayEmptyInbox == null || lastDayEmptyInbox === '') return null

    const reachedAt = moment(lastDayEmptyInbox)
    if (!reachedAt.isValid()) return null

    const today = moment(todayTimestamp)
    if (!reachedAt.isSame(today, 'day')) return null
    if (!normalizeEmptyInboxDays(emptyInboxDays).includes(today.format(EMPTY_INBOX_DATE_FORMAT))) return null

    return reachedAt.valueOf()
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

export const buildEmptyInboxMonthSegments = weeks =>
    weeks.reduce((segments, week) => {
        if (week.monthName || segments.length === 0) {
            segments.push({ monthName: week.monthName, numberOfWeeks: 1 })
        } else {
            segments[segments.length - 1].numberOfWeeks += 1
        }

        return segments
    }, [])
