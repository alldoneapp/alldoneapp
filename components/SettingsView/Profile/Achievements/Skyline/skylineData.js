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

const clamp01 = value => Math.max(0, Math.min(1, value))
const mixHex = (from, to, amount) => {
    const a = [1, 3, 5].map(i => parseInt(from.slice(i, i + 2), 16))
    const b = [1, 3, 5].map(i => parseInt(to.slice(i, i + 2), 16))
    const t = clamp01(amount)
    return `#${a
        .map((v, i) =>
            Math.round(v + (b[i] - v) * t)
                .toString(16)
                .padStart(2, '0')
        )
        .join('')}`.toUpperCase()
}

const SUN_COLOR = '#FFFFFF'
const LOW_SUN_COLOR = '#FFCE8F' // UtilityYellow150 — morning and evening light
const MOON_COLOR = '#D6E3FF' // UtilityDarkBlue125 — cool night light
const MOON = { azimuth: 0.6, elevation: 0.95 }
const DEG = Math.PI / 180

/**
 * Where on earth the user probably is, without asking. IANA time zones are named after a city, so
 * the common ones map straight to coordinates; anything else falls back to a longitude from the UTC
 * offset (15° per hour) and a mid-latitude on the right hemisphere. Good to within an hour or so of
 * sunset, which is all a lighting mood needs — and it never triggers a location-permission prompt.
 */
const ZONE_COORDINATES = {
    'Europe/Berlin': [52.52, 13.4],
    'Europe/Vienna': [48.21, 16.37],
    'Europe/Zurich': [47.38, 8.54],
    'Europe/Amsterdam': [52.37, 4.9],
    'Europe/Brussels': [50.85, 4.35],
    'Europe/Paris': [48.86, 2.35],
    'Europe/London': [51.51, -0.13],
    'Europe/Dublin': [53.35, -6.26],
    'Europe/Madrid': [40.42, -3.7],
    'Europe/Lisbon': [38.72, -9.14],
    'Europe/Rome': [41.9, 12.5],
    'Europe/Prague': [50.08, 14.44],
    'Europe/Warsaw': [52.23, 21.01],
    'Europe/Copenhagen': [55.68, 12.57],
    'Europe/Stockholm': [59.33, 18.07],
    'Europe/Oslo': [59.91, 10.75],
    'Europe/Helsinki': [60.17, 24.94],
    'Europe/Athens': [37.98, 23.73],
    'Europe/Istanbul': [41.01, 28.98],
    'Europe/Kiev': [50.45, 30.52],
    'Europe/Kyiv': [50.45, 30.52],
    'Europe/Moscow': [55.76, 37.62],
    'America/New_York': [40.71, -74.01],
    'America/Chicago': [41.88, -87.63],
    'America/Denver': [39.74, -104.99],
    'America/Los_Angeles': [34.05, -118.24],
    'America/Toronto': [43.65, -79.38],
    'America/Vancouver': [49.28, -123.12],
    'America/Mexico_City': [19.43, -99.13],
    'America/Bogota': [4.71, -74.07],
    'America/Lima': [-12.05, -77.04],
    'America/Santiago': [-33.45, -70.67],
    'America/Buenos_Aires': [-34.6, -58.38],
    'America/Argentina/Buenos_Aires': [-34.6, -58.38],
    'America/Sao_Paulo': [-23.55, -46.63],
    'Asia/Dubai': [25.2, 55.27],
    'Asia/Kolkata': [22.57, 88.36],
    'Asia/Singapore': [1.35, 103.82],
    'Asia/Bangkok': [13.76, 100.5],
    'Asia/Shanghai': [31.23, 121.47],
    'Asia/Hong_Kong': [22.32, 114.17],
    'Asia/Tokyo': [35.68, 139.69],
    'Asia/Seoul': [37.57, 126.98],
    'Australia/Sydney': [-33.87, 151.21],
    'Australia/Melbourne': [-37.81, 144.96],
    'Pacific/Auckland': [-36.85, 174.76],
    'Africa/Cairo': [30.04, 31.24],
    'Africa/Lagos': [6.52, 3.38],
    'Africa/Nairobi': [-1.29, 36.82],
    'Africa/Johannesburg': [-26.2, 28.05],
}
const SOUTHERN_ZONE =
    /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Fiji|Chatham)|^America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima)|^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Lusaka)/

export function guessLocation(timeZone, offsetMinutes = new Date().getTimezoneOffset()) {
    let zone = timeZone
    if (zone === undefined) {
        try {
            zone = Intl.DateTimeFormat().resolvedOptions().timeZone
        } catch (error) {
            zone = ''
        }
    }
    const known = zone && ZONE_COORDINATES[zone]
    if (known) return { latitude: known[0], longitude: known[1] }
    return {
        latitude: zone && SOUTHERN_ZONE.test(zone) ? -35 : 48,
        longitude: Math.max(-180, Math.min(180, -offsetMinutes / 4)),
    }
}

/**
 * The sun's position in the sky at `date` for a place on earth (the usual low-precision almanac,
 * accurate to a fraction of a degree — far better than a lighting mood needs).
 *
 * @returns {{ elevation: number, azimuth: number }} radians; azimuth from north, clockwise (east = π/2)
 */
export function getSunPosition(date, { latitude, longitude }) {
    const days = date.getTime() / 86400000 + 2440587.5 - 2451545.0
    const meanLongitude = (280.46 + 0.9856474 * days) % 360
    const meanAnomaly = ((357.528 + 0.9856003 * days) % 360) * DEG
    const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG
    const obliquity = (23.439 - 0.0000004 * days) * DEG
    const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude))
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))
    const siderealDegrees = ((18.697374558 + 24.06570982441908 * days) % 24) * 15
    const hourAngle = (siderealDegrees + longitude) * DEG - rightAscension
    const phi = latitude * DEG
    const elevation = Math.asin(
        Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle)
    )
    const azimuth = Math.atan2(
        -Math.sin(hourAngle),
        Math.tan(declination) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle)
    )
    return { elevation, azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI) }
}

/**
 * How the city is lit at `date` where the user is — when it is dark in their city, it is dark here.
 *
 * The sun is where it really is (`getSunPosition`): it rises in the east, stands highest at local
 * solar noon, and sits lower and warmer in winter. Light blends from day to night through civil
 * twilight — the sun between 6° above and 6° below the horizon — which is also exactly when the
 * street lamps come on. At night a dimmer, cooler moon takes over. The card's white stays the sky at
 * every hour: only the light on the city changes.
 *
 * The city faces south: its front (the current week's side) is where the sun stands at noon for a
 * northern-hemisphere user, so the midday sun lights the faces the camera sees.
 *
 * @returns {{ azimuth: number, elevation: number, lightColor: string, lightStrength: number,
 *   ambientColor: string, ambientStrength: number, lamps: number, phase: string }}
 *   azimuth 0 = from the front, negative = east (left); strengths are 0..1 multipliers on full
 *   daylight; lamps 0..1
 */
export function getDaylight(date = new Date(), location = guessLocation()) {
    const sun = getSunPosition(date, location)
    const elevationDegrees = sun.elevation / DEG
    const day = clamp01((elevationDegrees + 6) / 12)
    const warmth = (1 - clamp01(elevationDegrees / 35)) ** 1.5
    const sunColor = mixHex(SUN_COLOR, LOW_SUN_COLOR, Math.min(1, warmth * 1.1))
    const bySun = day >= 0.5
    return {
        azimuth: bySun ? sun.azimuth - Math.PI : MOON.azimuth,
        // The light never comes from lower than ~17°: a truer grazing sun leaves the whole city in
        // gloom at exactly the golden hour. Its shadows are still ~3x as long as the buildings.
        elevation: bySun ? Math.max(sun.elevation, 0.3) : MOON.elevation,
        lightColor: mixHex(MOON_COLOR, sunColor, day),
        lightStrength: 0.35 + 0.65 * day,
        // Golden hour: when the sun is low the whole sky, not just the sun, turns a little warm.
        ambientColor: mixHex(MOON_COLOR, mixHex(SUN_COLOR, '#FFF6EB', warmth), day),
        ambientStrength: 0.62 + 0.38 * day,
        lamps: clamp01((0.6 - day) / 0.6),
        phase: day >= 1 ? 'day' : day <= 0 ? 'night' : sun.azimuth < Math.PI ? 'dawn' : 'dusk',
    }
}

export const formatSkylineMinutes = minutes => {
    const total = Math.round(minutes || 0)
    if (!total) return null
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return hours ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`
}
