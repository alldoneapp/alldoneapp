import moment from 'moment'

import {
    buildSkylineDays,
    buildSkylineWeeks,
    getBuildingType,
    getDaylight,
    getSunPosition,
    guessLocation,
    getIntegrity,
    HIT_POINTS,
    rollHitPoints,
    formatSkylineMinutes,
    getOrbitView,
    getProjectColorAt,
    getSkylineHeight,
    getSkylineScale,
    SKYLINE_MAX_HEIGHT,
    SKYLINE_REST_VIEW,
    SKYLINE_WEEKS,
} from './skylineData'

const TODAY = moment('2026-09-25T12:00:00').valueOf() // a Friday
const dayNumber = key => parseInt(key.replace(/-/g, ''), 10)

const projects = [
    { id: 'work', name: 'Work', color: '#0C66FF' },
    { id: 'home', name: 'Home', color: '#FF8A5C' },
]

describe('skyline data', () => {
    it('covers the last month and stops at today', () => {
        const weeks = buildSkylineWeeks([], TODAY)
        const days = buildSkylineDays(weeks, {}, projects)

        expect(weeks).toHaveLength(SKYLINE_WEEKS)
        // Monday-aligned: 4 full weeks plus Monday..Friday of this one.
        expect(days).toHaveLength(4 * 7 + 5)
        expect(days[days.length - 1].isToday).toBe(true)
        expect(days[days.length - 1].weekday).toBe(4)
    })

    it('sums every project into one building and colours it by the busiest project', () => {
        const weeks = buildSkylineWeeks(['2026-09-24'], TODAY)
        const key = dayNumber('2026-09-24')
        const days = buildSkylineDays(
            weeks,
            {
                work: { [key]: { doneTasks: 2, doneTime: 30 } },
                home: { [key]: { doneTasks: 5, doneTime: 45 } },
            },
            projects
        )
        const day = days.find(entry => entry.dateKey === '2026-09-24')

        expect(day.tasks).toBe(7)
        expect(day.minutes).toBe(75)
        expect(day.dominantColor).toBe('#FF8A5C')
        expect(day.byProject.map(entry => entry.project.id)).toEqual(['home', 'work'])
        expect(day.achieved).toBe(true)
    })

    it('keeps an empty day as a flat plot, never a hole', () => {
        const weeks = buildSkylineWeeks([], TODAY)
        const day = buildSkylineDays(weeks, {}, projects)[0]

        expect(day.tasks).toBe(0)
        expect(day.dominantColor).toBeNull()
        expect(getSkylineHeight(0)).toBeGreaterThan(0)
        expect(getSkylineHeight(10, 20)).toBeGreaterThan(getSkylineHeight(1, 20))
        // One absurd day must not tower over the rest of the city.
        expect(getSkylineHeight(500, 20)).toBe(getSkylineHeight(40, 20))
        expect(getSkylineHeight(500, 20)).toBeLessThan(SKYLINE_MAX_HEIGHT * 1.2)
    })

    it('ignores statistics of projects that are not passed in', () => {
        const weeks = buildSkylineWeeks([], TODAY)
        const key = dayNumber('2026-09-24')
        const days = buildSkylineDays(weeks, { archived: { [key]: { doneTasks: 9, doneTime: 0 } } }, projects)

        expect(days.find(entry => entry.dateKey === '2026-09-24').tasks).toBe(0)
    })

    it("scales heights to the user's own year", () => {
        const days = [0, 2, 3, 4, 5, 6, 8, 10, 12, 50].map(tasks => ({ tasks }))
        expect(getSkylineScale(days)).toBe(50)
        expect(getSkylineScale(Array.from({ length: 100 }, (_, i) => ({ tasks: i < 99 ? 10 : 200 })))).toBe(10)
        expect(getSkylineScale([{ tasks: 0 }])).toBe(5)
        expect(getSkylineScale([{ tasks: 1 }, { tasks: 2 }])).toBe(5)
    })

    it('flies around the front of the city without going round the back', () => {
        expect(getOrbitView(null)).toEqual(SKYLINE_REST_VIEW)
        for (let t = 0; t < 600; t += 1.7) {
            const { azimuth, elevation } = getOrbitView(t)
            expect(Math.abs(azimuth)).toBeLessThan(Math.PI / 2)
            expect(elevation).toBeGreaterThan(0.55)
            expect(elevation).toBeLessThan(0.95)
        }
        expect(getOrbitView(10)).not.toEqual(getOrbitView(40))
    })

    it("lays the day's projects end to end by their share of the tasks", () => {
        const day = {
            byProject: [
                { project: { color: '#AAAAAA' }, count: 7 },
                { project: { color: '#BBBBBB' }, count: 3 },
            ],
        }
        expect(getProjectColorAt(day, 0)).toBe('#AAAAAA')
        expect(getProjectColorAt(day, 0.69)).toBe('#AAAAAA')
        expect(getProjectColorAt(day, 0.71)).toBe('#BBBBBB')
        expect(getProjectColorAt(day, 1)).toBe('#BBBBBB')
        expect(getProjectColorAt({ byProject: [] }, 0.5)).toBeNull()
    })

    describe('light by the real sun where the user is', () => {
        const BERLIN = { latitude: 52.52, longitude: 13.4 }
        const utc = (...parts) => new Date(Date.UTC(...parts))

        it('puts the sun where it really is', () => {
            // Berlin, 21 June: solar noon ~11:12 UTC at ~61° elevation, due south.
            const summerNoon = getSunPosition(utc(2026, 5, 21, 11, 12), BERLIN)
            expect(summerNoon.elevation / (Math.PI / 180)).toBeGreaterThan(59)
            expect(summerNoon.elevation / (Math.PI / 180)).toBeLessThan(62)
            expect(Math.abs(summerNoon.azimuth - Math.PI)).toBeLessThan(0.1)
            // 21 December noon is far lower (~14°).
            const winterNoon = getSunPosition(utc(2026, 11, 21, 11, 12), BERLIN)
            expect(winterNoon.elevation / (Math.PI / 180)).toBeGreaterThan(12)
            expect(winterNoon.elevation / (Math.PI / 180)).toBeLessThan(16)
            // Midnight: below the horizon.
            expect(getSunPosition(utc(2026, 5, 21, 23, 0), BERLIN).elevation).toBeLessThan(0)
        })

        it("switches the lights on when it gets dark in the user's city", () => {
            // 25 September in Berlin: sunrise ~05:05 UTC, sunset ~17:05 UTC.
            const noon = getDaylight(utc(2026, 8, 25, 11, 10), BERLIN)
            const morning = getDaylight(utc(2026, 8, 25, 6, 0), BERLIN)
            const evening = getDaylight(utc(2026, 8, 25, 16, 20), BERLIN)
            const night = getDaylight(utc(2026, 8, 25, 21, 0), BERLIN)

            expect(noon.phase).toBe('day')
            expect(noon.lamps).toBe(0)
            expect(noon.elevation).toBeGreaterThan(morning.elevation)
            expect(morning.azimuth).toBeLessThan(0) // from the east
            expect(evening.azimuth).toBeGreaterThan(0) // from the west
            expect(morning.lightColor).not.toBe('#FFFFFF') // low sun is warm

            expect(night.phase).toBe('night')
            expect(night.lightColor).toBe('#D6E3FF')
            expect(night.lamps).toBe(1)
            expect(night.lightStrength).toBeLessThan(noon.lightStrength)

            // Just after sunset (civil twilight) the lamps are coming on, not yet full.
            const dusk = getDaylight(utc(2026, 8, 25, 17, 25), BERLIN)
            expect(dusk.phase).toBe('dusk')
            expect(dusk.lamps).toBeGreaterThan(0)
            expect(dusk.lightStrength).toBeGreaterThan(night.lightStrength)
        })

        it("finds the user's city from the time zone, or estimates it from the offset", () => {
            expect(guessLocation('Europe/Berlin')).toEqual({ latitude: 52.52, longitude: 13.4 })
            const unknown = guessLocation('America/Anchorage', 540)
            expect(unknown.latitude).toBeGreaterThan(0)
            expect(unknown.longitude).toBe(-135)
            expect(guessLocation('Australia/Perth', -480).latitude).toBeLessThan(0)
            expect(guessLocation('', 0)).toEqual({ latitude: 48, longitude: -0 })
        })
    })

    it('formats logged time', () => {
        expect(formatSkylineMinutes(0)).toBeNull()
        expect(formatSkylineMinutes(45)).toBe('45m')
        expect(formatSkylineMinutes(125)).toBe('2h 05m')
    })
})
