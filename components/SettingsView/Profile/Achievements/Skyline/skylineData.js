import { buildEmptyInboxActivityWeeks } from '../AchievementsHelper'

export const SKYLINE_WEEKS = 53

/**
 * Turns the empty-inbox weeks and the per-project statistics into one record per building.
 *
 * Pure on purpose: the scene only draws what this returns, so everything that decides what a
 * building MEANS (its height, its colour, whether its roof glows) is testable without WebGL.
 *
 * @param {Array} weeks output of `buildEmptyInboxActivityWeeks`
 * @param {Object} statisticsByProject projectId → YYYYMMDD → { doneTasks, doneTime }
 * @param {Array<{id: string, name: string, color: string}>} projects the projects the statistics
 *   were read for; their order breaks ties for the dominant project
 */
export function buildSkylineDays(weeks, statisticsByProject = {}, projects = []) {
    const days = []
    weeks.forEach((week, weekIndex) => {
        week.days.forEach((day, weekday) => {
            if (day.isFuture) return
            const dayNumber = parseInt(day.date.format('YYYYMMDD'), 10)
            let tasks = 0
            let minutes = 0
            const byProject = []
            projects.forEach(project => {
                const entry = statisticsByProject[project.id] && statisticsByProject[project.id][dayNumber]
                if (!entry) return
                tasks += entry.doneTasks
                minutes += entry.doneTime
                if (entry.doneTasks > 0) byProject.push({ project, count: entry.doneTasks })
            })
            byProject.sort((a, b) => b.count - a.count)
            days.push({
                dateKey: day.dateKey,
                date: day.date,
                week: weekIndex,
                weekday,
                tasks,
                minutes,
                byProject,
                dominantColor: byProject.length ? byProject[0].project.color : null,
                achieved: day.achieved,
                isToday: day.isToday,
            })
        })
    })
    return days
}

export const buildSkylineWeeks = (emptyInboxDays, todayTimestamp) =>
    buildEmptyInboxActivityWeeks(emptyInboxDays, SKYLINE_WEEKS, todayTimestamp)

/** Building height in scene units. A day with nothing done is a flat plot, never a hole. */
export const getSkylineHeight = tasks => 0.08 + Math.min(tasks, 40) * 0.36

export const formatSkylineMinutes = minutes => {
    const total = Math.round(minutes || 0)
    if (!total) return null
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return hours ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`
}
