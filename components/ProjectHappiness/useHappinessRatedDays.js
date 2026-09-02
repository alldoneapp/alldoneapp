import { useEffect, useState } from 'react'
import moment from 'moment'

import Backend from '../../utils/BackendBridge'

export const CALENDAR_DAY_FORMAT = 'YYYY-MM-DD'

/**
 * Which days of one month already carry a happiness rating, across projects.
 *
 * The rating popup's date picker marks those days with a dot, so "was this day
 * rated already?" is answered before a day is picked, not after. One range
 * watcher per project over the visible month — the documents are tiny and the
 * watchers are detached the moment the picker closes or the month changes.
 *
 * @returns {{ [dayString: string]: number }} rated project count per
 *   `YYYY-MM-DD` day of the month
 */
export default function useHappinessRatedDays({
    projects = [],
    userId,
    month,
    enabled = true,
    watcherKeyPrefix = 'happiness_rated_days',
}) {
    const [ratedDaysByProject, setRatedDaysByProject] = useState({})

    const projectIdsKey = projects.map(project => project.id).join(',')
    const monthKey = month ? moment(month).format('YYYY-MM') : null

    useEffect(() => {
        setRatedDaysByProject({})
        if (!enabled || !userId || !monthKey || projects.length === 0) return

        const monthStart = moment(monthKey, 'YYYY-MM').startOf('month').valueOf()
        const monthEnd = moment(monthKey, 'YYYY-MM').endOf('month').valueOf()
        const watcherKeys = projects.map(project => `${watcherKeyPrefix}_${project.id}`)

        projects.forEach(project => {
            Backend.watchProjectHappinessByRange(
                project.id,
                userId,
                monthStart,
                monthEnd,
                `${watcherKeyPrefix}_${project.id}`,
                (projectId, entries) => {
                    setRatedDaysByProject(state => ({
                        ...state,
                        [projectId]: entries
                            .filter(entry => entry.rating)
                            .map(entry => moment(entry.timestamp).format(CALENDAR_DAY_FORMAT)),
                    }))
                }
            )
        })

        return () => watcherKeys.forEach(key => Backend.unwatch(key))
    }, [projectIdsKey, userId, monthKey, enabled, watcherKeyPrefix])

    const ratedProjectsByDay = {}
    Object.values(ratedDaysByProject).forEach(days => {
        days.forEach(day => {
            ratedProjectsByDay[day] = (ratedProjectsByDay[day] || 0) + 1
        })
    })
    return ratedProjectsByDay
}
