import moment from 'moment'

import {
    buildSkylineDays,
    buildSkylineWeeks,
    getBuildingType,
    formatSkylineMinutes,
    getFlyoverView,
    getSkylineColor,
    getSkylineHeight,
    getSkylineScale,
    SKYLINE_MAX_HEIGHT,
    SKYLINE_MAX_TILT,
    SKYLINE_RAMP,
    SKYLINE_WEEKS,
} from './skylineData'

const TODAY = moment('2026-09-25T12:00:00').valueOf() // a Friday
const dayNumber = key => parseInt(key.replace(/-/g, ''), 10)

const projects = [
    { id: 'work', name: 'Work', color: '#0C66FF' },
    { id: 'home', name: 'Home', color: '#FF8A5C' },
]

describe('skyline data', () => {
    it('covers the last quarter and stops at today', () => {
        const weeks = buildSkylineWeeks([], TODAY)
        const days = buildSkylineDays(weeks, {}, projects)

        expect(weeks).toHaveLength(SKYLINE_WEEKS)
        // Monday-aligned: 12 full weeks plus Monday..Friday of this one.
        expect(days).toHaveLength(12 * 7 + 5)
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

    it("colours buildings only with the app's blue ramp", () => {
        expect(getSkylineColor(0, 10)).toBe(SKYLINE_RAMP[0].toLowerCase())
        expect(getSkylineColor(5, 10)).toBe(SKYLINE_RAMP[1].toLowerCase())
        expect(getSkylineColor(10, 10)).toBe(SKYLINE_RAMP[2].toLowerCase())
        expect(getSkylineColor(99, 10)).toBe(SKYLINE_RAMP[2].toLowerCase())
    })

    it('looks straight down when the card is in the middle of the screen', () => {
        const entering = getFlyoverView(1)
        const centred = getFlyoverView(0.5)
        const leaving = getFlyoverView(0)
        expect(centred.tilt).toBe(0)
        // Scrolling down flies forward: below the middle the plane is short of the city (camera on
        // the far side), past the middle it is beyond it (camera on the legend side).
        expect(entering.tilt).toBeLessThan(0)
        expect(leaving.tilt).toBeGreaterThan(0)
        expect(entering.tilt).toBeCloseTo(-leaving.tilt)
        expect(Math.abs(entering.tilt)).toBeLessThanOrEqual(SKYLINE_MAX_TILT)
        expect(getFlyoverView(0.4).tilt).toBeGreaterThan(0)
        expect(getFlyoverView(-3)).toEqual(leaving)
        expect(getFlyoverView(NaN)).toEqual(centred)
    })

    it('turns busier days into taller kinds of building', () => {
        expect(getBuildingType(0, 10)).toBe('park')
        expect(getBuildingType(2, 10)).toBe('house')
        expect(getBuildingType(4, 10)).toBe('midrise')
        expect(getBuildingType(7, 10)).toBe('tower')
        expect(getBuildingType(9, 10)).toBe('skyscraper')
        expect(getBuildingType(40, 10)).toBe('skyscraper')
    })

    it('formats logged time', () => {
        expect(formatSkylineMinutes(0)).toBeNull()
        expect(formatSkylineMinutes(45)).toBe('45m')
        expect(formatSkylineMinutes(125)).toBe('2h 05m')
    })
})
