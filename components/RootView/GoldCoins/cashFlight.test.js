import { formatEarnings, getNoteCount, getTaskEarnings, NOTE_LIFE, notePositionAt, planCashBurst } from './cashFlight'

const project = { hourlyRatesData: { currency: 'EUR', hourlyRates: { me: 90, other: 0 } } }

describe('money earned by a completed task', () => {
    it("is the estimate at the user's hourly rate, like the statistics count it", () => {
        expect(getTaskEarnings(project, 'me', 25)).toEqual({ amount: 37.5, currency: 'EUR' })
        expect(getTaskEarnings(project, 'me', 60)).toEqual({ amount: 90, currency: 'EUR' })
    })

    it('is nothing without a rate, an estimate or a currency', () => {
        expect(getTaskEarnings(project, 'other', 60)).toBeNull()
        expect(getTaskEarnings(project, 'nobody', 60)).toBeNull()
        expect(getTaskEarnings(project, 'me', 0)).toBeNull()
        expect(getTaskEarnings({ hourlyRatesData: { hourlyRates: { me: 90 } } }, 'me', 60)).toBeNull()
        expect(getTaskEarnings(undefined, 'me', 60)).toBeNull()
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
    })

    it('throws the notes up, lets them flutter down slowly, and fades them out', () => {
        const [note] = planCashBurst({ x: 200, y: 400 }, 50, () => 0.5)
        expect(notePositionAt(note, -0.01).started).toBe(false)
        const rising = notePositionAt(note, 0.2)
        expect(rising.y).toBeLessThan(400)
        const late = notePositionAt(note, 1.2)
        const later = notePositionAt(note, 1.4)
        // Falling, but slowly: paper, not a stone.
        expect(later.y).toBeGreaterThan(late.y)
        expect((later.y - late.y) / 0.2).toBeLessThanOrEqual(75)
        expect(notePositionAt(note, NOTE_LIFE - 0.05).opacity).toBeLessThan(0.2)
        expect(notePositionAt(note, NOTE_LIFE + 0.01).done).toBe(true)
    })
})
