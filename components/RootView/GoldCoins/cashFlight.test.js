import {
    CASH_STYLE_NAMES,
    formatEarnings,
    getNoteCount,
    getTaskEarnings,
    notePositionAt,
    planCashBurst,
} from './cashFlight'

const project = { hourlyRatesData: { currency: 'EUR', hourlyRates: { me: 90, other: 0 } } }

describe('money earned by a completed task', () => {
    it("is the estimate at the user's hourly rate, like the statistics count it", () => {
        expect(getTaskEarnings(project, 'me', 25)).toEqual({ amount: 37.5, currency: 'EUR', dayRate: false })
        expect(getTaskEarnings(project, 'me', 60)).toEqual({ amount: 90, currency: 'EUR', dayRate: false })
    })

    it('is nothing without a rate, an estimate or a currency', () => {
        expect(getTaskEarnings(project, 'other', 60)).toBeNull()
        expect(getTaskEarnings(project, 'nobody', 60)).toBeNull()
        expect(getTaskEarnings(project, 'me', 0)).toBeNull()
        expect(getTaskEarnings({ hourlyRatesData: { hourlyRates: { me: 90 } } }, 'me', 60)).toBeNull()
        expect(getTaskEarnings(undefined, 'me', 60)).toBeNull()
    })

    it('on a day-rate project, throws cash for every task but names no amount', () => {
        const dayRateProject = { ...project, dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 } }
        expect(getTaskEarnings(dayRateProject, 'me', 0)).toEqual({ amount: null, currency: 'EUR', dayRate: true })
        expect(getTaskEarnings(dayRateProject, 'me', 120)).toEqual({ amount: null, currency: 'EUR', dayRate: true })
        expect(getTaskEarnings(dayRateProject, 'other', 0)).toEqual({ amount: null, currency: 'EUR', dayRate: true })
        // Switched off: back to billing by the hour.
        expect(getTaskEarnings({ ...project, dayRateTimeLog: { enabled: false } }, 'me', 0)).toBeNull()
    })

    it("shows the amount in the project's currency", () => {
        expect(formatEarnings(37.5, 'EUR', 'en-US')).toBe('+€37.50')
        expect(formatEarnings(12, 'USD', 'en-US')).toBe('+$12.00')
        expect(formatEarnings(5, 'NOT-A-CURRENCY', 'en-US')).toBe('+5.00 NOT-A-CURRENCY')
    })

    it('throws more notes for more money, within bounds', () => {
        expect(getNoteCount(1)).toBe(3)
        expect(getNoteCount(100)).toBeGreaterThan(getNoteCount(20))
        expect(getNoteCount(100000)).toBe(12)
        expect(getNoteCount(null)).toBe(5)
    })

    it('throws the notes up, lets them flutter down slowly, and fades them out', () => {
        const [note] = planCashBurst({ x: 200, y: 400 }, 50, () => 0.5, 1200, 'fountain')
        expect(notePositionAt(note, -0.01).started).toBe(false)
        const rising = notePositionAt(note, 0.2)
        expect(rising.y).toBeLessThan(400)
        const late = notePositionAt(note, 1.2)
        const later = notePositionAt(note, 1.4)
        // Falling, but slowly: paper, not a stone.
        expect(later.y).toBeGreaterThan(late.y)
        expect((later.y - late.y) / 0.2).toBeLessThanOrEqual(75)
        expect(notePositionAt(note, note.life - 0.05).opacity).toBeLessThan(0.2)
        expect(notePositionAt(note, note.life + 0.01).done).toBe(true)
    })

    it('has ten choreographies', () => {
        expect(CASH_STYLE_NAMES).toHaveLength(10)
    })

    it.each(CASH_STYLE_NAMES)('%s: starts near the task, stays finite, fades out and ends', style => {
        let state = 5
        const random = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646
        const from = { x: 120, y: 500 }
        const notes = planCashBurst(from, 80, random, 1200, style)
        expect(notes.length).toBeGreaterThanOrEqual(3)
        notes.forEach(note => {
            expect(note.style).toBe(style)
            expect(note.delay + note.life).toBeLessThan(3)
            for (let s = 0; s < note.life; s += note.life / 30) {
                const p = notePositionAt(note, note.delay + s)
                ;['x', 'y', 'rotX', 'rotY', 'rotZ', 'scale', 'opacity'].forEach(key =>
                    expect(Number.isFinite(p[key])).toBe(true)
                )
            }
            // Starts invisible and fades in, so a note that begins away from the checkbox (rain)
            // never pops in.
            expect(notePositionAt(note, note.delay).opacity).toBe(0)
            expect(notePositionAt(note, note.delay + note.life - 0.02).opacity).toBeLessThan(0.1)
            expect(notePositionAt(note, note.delay + note.life + 0.01).done).toBe(true)
        })
    })
})
