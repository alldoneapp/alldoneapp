import moment from 'moment'

import { buildSkylineDays, buildSkylineWeeks, formatSkylineMinutes, getSkylineHeight, SKYLINE_WEEKS } from './skylineData'

const TODAY = moment('2026-09-25T12:00:00').valueOf() // a Friday
const dayNumber = key => parseInt(key.replace(/-/g, ''), 10)

const projects = [
    { id: 'work', name: 'Work', color: '#0C66FF' },
    { id: 'home', name: 'Home', color: '#FF8A5C' },
]

describe('skyline data', () => {
    it('covers a full year of weeks and stops at today', () => {
        const weeks = buildSkylineWeeks([], TODAY)
        const days = buildSkylineDays(weeks, {}, projects)

        expect(weeks).toHaveLength(SKYLINE_WEEKS)
        // Monday-aligned: 52 full weeks plus Monday..Friday of this one.
        expect(days).toHaveLength(52 * 7 + 5)
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
        expect(getSkylineHeight(10)).toBeGreaterThan(getSkylineHeight(1))
        // One absurd day must not turn the rest of the city into a flat line.
        expect(getSkylineHeight(500)).toBe(getSkylineHeight(40))
    })

    it('ignores statistics of projects that are not passed in', () => {
        const weeks = buildSkylineWeeks([], TODAY)
        const key = dayNumber('2026-09-24')
        const days = buildSkylineDays(weeks, { archived: { [key]: { doneTasks: 9, doneTime: 0 } } }, projects)

        expect(days.find(entry => entry.dateKey === '2026-09-24').tasks).toBe(0)
    })

    it('formats logged time', () => {
        expect(formatSkylineMinutes(0)).toBeNull()
        expect(formatSkylineMinutes(45)).toBe('45m')
        expect(formatSkylineMinutes(125)).toBe('2h 05m')
    })
})
