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

/** Tallest building, in scene units (one day is one unit wide). */
export const SKYLINE_MAX_HEIGHT = 4.5
const FLOOR_HEIGHT = 0.1

/**
 * The task count a building must reach to be full height. Taken from the user's own year (95th
 * percentile of active days) rather than a fixed number, so a user who finishes 5 tasks a day and one
 * who finishes 50 both get a skyline, and one extreme day cannot flatten everything else.
 */
export function getSkylineScale(days) {
    const counts = days
        .map(day => day.tasks)
        .filter(tasks => tasks > 0)
        .sort((a, b) => a - b)
    if (!counts.length) return 5
    const index = Math.min(counts.length - 1, Math.floor(counts.length * 0.95))
    return Math.max(5, counts[index])
}

/** Building height in scene units. A day with nothing done is a flat plot, never a hole. */
export const getSkylineHeight = (tasks, scale = 5) =>
    tasks > 0 ? FLOOR_HEIGHT + Math.min(tasks / scale, 1.15) * SKYLINE_MAX_HEIGHT : FLOOR_HEIGHT * 0.4

/**
 * The app's blue ramp, light to deep: UtilityDarkBlue125 → Primary100 → Primary400. A building's
 * colour says the same thing as its height, so the city reads from straight above too, where heights
 * cannot be seen.
 */
export const SKYLINE_RAMP = ['#D6E3FF', '#007FFF', '#0A44A5']

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const rgbToHex = rgb => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

export function getSkylineColor(tasks, scale = 5) {
    const t = Math.max(0, Math.min(1, tasks / scale))
    const [from, to, local] =
        t < 0.5 ? [SKYLINE_RAMP[0], SKYLINE_RAMP[1], t / 0.5] : [SKYLINE_RAMP[1], SKYLINE_RAMP[2], (t - 0.5) / 0.5]
    const a = hexToRgb(from)
    const b = hexToRgb(to)
    return rgbToHex(a.map((v, i) => v + (b[i] - v) * local))
}

/**
 * Where the camera is for a given scroll position — the "plane flying over the city".
 *
 * `progress` is where the card's middle sits in the viewport: 1 at the bottom edge (the card has
 * just scrolled in), 0 at the top edge (it is about to leave). Coming in, you see the skyline from
 * ahead and at an angle; as you scroll on you pass over it until you look straight down on the map.
 *
 * @returns {{ tilt: number, forward: number }} tilt = radians away from straight down,
 *   forward = how far along the city (scene units) the camera is looking
 */
export function getFlyoverView(progress) {
    const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0.5))
    return {
        tilt: 0.08 + p * 0.82,
        forward: (p - 0.5) * 3,
    }
}

export const formatSkylineMinutes = minutes => {
    const total = Math.round(minutes || 0)
    if (!total) return null
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return hours ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`
}
