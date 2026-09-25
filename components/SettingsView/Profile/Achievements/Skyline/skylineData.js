import { buildEmptyInboxActivityWeeks } from '../AchievementsHelper'

/** The last month: 5 Monday-aligned weeks ending with the current one. */
export const SKYLINE_WEEKS = 5

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
export const SKYLINE_MAX_HEIGHT = 3.2
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
 * What kind of building a day becomes. The type follows the same relative measure as the height,
 * so the skyline reads as a skyline — houses on quiet days, skyscrapers on the busiest — rather
 * than as a bar chart of identical boxes.
 */
export const BUILDING_TYPES = ['park', 'house', 'midrise', 'tower', 'skyscraper']

export function getBuildingType(tasks, scale = 5) {
    if (!(tasks > 0)) return 'park'
    const t = tasks / scale
    if (t < 0.3) return 'house'
    if (t < 0.6) return 'midrise'
    if (t < 0.85) return 'tower'
    return 'skyscraper'
}

/**
 * Demolition: how many taps a building takes. Deliberately a range, rolled per building per visit,
 * so the player never quite knows which tap will bring it down — and bigger buildings take longer.
 */
export const HIT_POINTS = {
    park: [1, 2],
    house: [2, 4],
    midrise: [3, 5],
    tower: [4, 7],
    skyscraper: [5, 9],
}
/** A lucky tap counts double (and looks it). */
export const CRITICAL_HIT_CHANCE = 0.15

export function rollHitPoints(type, random = Math.random) {
    const [min, max] = HIT_POINTS[type] || HIT_POINTS.house
    return min + Math.min(max - min, Math.floor(random() * (max - min + 1)))
}

/**
 * How much of a building is still standing after a hit, 0..1. Each hit knocks a chunk of floors
 * off, but a building never shrinks below a third before the final blow — the collapse is the
 * payoff and must stay a visible event, not the last step of a slow melt.
 */
export function getIntegrity(hitPoints, maxHitPoints) {
    if (hitPoints <= 0) return 0
    return 0.32 + 0.68 * Math.min(1, hitPoints / maxHitPoints)
}

/**
 * The project colour at `fraction` (0..1) of a day's work: projects are laid end to end by how many
 * tasks each contributed, busiest first. A building split into parts uses this to show the day's
 * mix — the lower 70% of a stack in the main project's colour, the rest in the next one's.
 * Returns null for a day with no completed tasks.
 */
export function getProjectColorAt(day, fraction) {
    const entries = (day && day.byProject) || []
    const total = entries.reduce((sum, entry) => sum + entry.count, 0)
    if (!total) return null
    let covered = 0
    const target = Math.max(0, Math.min(1, fraction)) * total
    for (const entry of entries) {
        covered += entry.count
        if (target < covered) return entry.project.color
    }
    return entries[entries.length - 1].project.color
}

/** The camera's resting view, used for reduced motion and as the centre of the sweep. */
export const SKYLINE_REST_VIEW = { azimuth: -0.35, elevation: 0.78 }

/**
 * Where the camera is at time `t` (seconds) — a slow flight around the front of the city.
 *
 * The azimuth sweeps about ±30° either side of its resting angle (a wider sweep turns the wide
 * calendar diagonal to the camera and shrinks the whole city to fit) and never goes round the back, so the
 * month and weekday legends printed on the ground are never seen upside down. The elevation rises
 * and dips between roughly 38° and 49° above the horizon on a different period, so the flight does
 * not repeat as a simple back-and-forth. `t == null` (reduced motion) is the resting view.
 *
 * @returns {{ azimuth: number, elevation: number }} radians; azimuth 0 = looking from the month
 *   legend side, elevation = angle above the ground plane
 */
export function getOrbitView(t) {
    if (t == null || !Number.isFinite(t)) return { ...SKYLINE_REST_VIEW }
    return {
        azimuth: SKYLINE_REST_VIEW.azimuth + Math.sin(t * 0.045) * 0.55,
        elevation: 0.76 + Math.sin(t * 0.031 + 1.1) * 0.1,
    }
}

export const formatSkylineMinutes = minutes => {
    const total = Math.round(minutes || 0)
    if (!total) return null
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return hours ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`
}
