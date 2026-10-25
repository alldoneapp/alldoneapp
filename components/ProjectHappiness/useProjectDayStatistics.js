import { useEffect, useState } from 'react'
import moment from 'moment'

import Backend from '../../utils/BackendBridge'
import { getSafeStatisticNumber } from '../../utils/StatisticDataHelper'

/** Key of a `statistics/{projectId}/{userId}/{day}` document. */
export const getStatisticsDateKey = date => moment(date).format('DDMMYYYY')

/**
 * The "Tasks done" count per project for one day.
 *
 * The rating popup shows, under every project, how busy that day was in it —
 * the same line the "new day" popup shows for the day that just ended. This
 * reads the same per-day statistics documents, one read per project, and
 * re-reads when the rated day changes.
 *
 * A count that has not arrived is `undefined`, never `0`: a project that has
 * not answered yet must not read as "nothing done". A read that fails (offline
 * with no cached copy) flips `unavailable`; the counts that did arrive stay.
 */
export default function useProjectDayStatistics({ projects = [], userId, date, enabled = true }) {
    const [doneTasksByProject, setDoneTasksByProject] = useState({})
    const [unavailable, setUnavailable] = useState(false)

    const projectIdsKey = projects.map(project => project.id).join(',')
    const dateKey = date ? getStatisticsDateKey(date) : null

    useEffect(() => {
        setDoneTasksByProject({})
        setUnavailable(false)
        if (!enabled || !userId || !dateKey || projects.length === 0) return

        // A read issued for the previous day can land after the day changed;
        // it must not be filed under the new one.
        let cancelled = false
        projects.forEach(project => {
            Backend.getUserStatistics(
                project.id,
                userId,
                dateKey,
                (projectId, statistics = {}) => {
                    if (cancelled) return
                    setDoneTasksByProject(state => ({
                        ...state,
                        [projectId]: getSafeStatisticNumber(statistics.doneTasks),
                    }))
                },
                () => {
                    if (!cancelled) setUnavailable(true)
                }
            )
        })

        return () => {
            cancelled = true
        }
    }, [projectIdsKey, userId, dateKey, enabled])

    const maxDoneTasks = Object.values(doneTasksByProject).reduce((max, value) => Math.max(max, value), 0)

    return { doneTasksByProject, maxDoneTasks, unavailable }
}
