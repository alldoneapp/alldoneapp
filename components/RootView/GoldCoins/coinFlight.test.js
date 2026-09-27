import { COIN_STYLE_NAMES, coinPositionAt, pickStyle, planCoinFlights } from './coinFlight'

const from = { x: 300, y: 500 }
const to = { x: 900, y: 40 }

const seeded = () => {
    let state = 11
    return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646
}

describe('gold coin flight', () => {
    it('has ten choreographies', () => {
        expect(COIN_STYLE_NAMES).toHaveLength(10)
    })

    it.each(COIN_STYLE_NAMES)('%s: every coin starts at the checkbox and lands exactly on the counter', style => {
        const flights = planCoinFlights(from, to, 5, seeded(), style)
        expect(flights).toHaveLength(5)
        flights.forEach(flight => {
            expect(flight.style).toBe(style)
            const start = coinPositionAt(flight, flight.delay)
            expect(start.started).toBe(true)
            expect(Math.hypot(start.x - from.x, start.y - from.y)).toBeLessThan(2)
            // Continuous and finite all the way through.
            for (let s = 0; s < flight.duration; s += flight.duration / 40) {
                const p = coinPositionAt(flight, flight.delay + s)
                expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.scale)).toBe(true)
            }
            const almost = coinPositionAt(flight, flight.delay + flight.duration - 0.001)
            expect(Math.hypot(almost.x - to.x, almost.y - to.y)).toBeLessThan(12)
            const end = coinPositionAt(flight, flight.delay + flight.duration)
            expect(end).toMatchObject({ landed: true, x: to.x, y: to.y })
            // A reward, not a wait: every coin is home within two seconds.
            expect(flight.delay + flight.duration).toBeLessThan(2)
        })
    })

    it('keeps the coin count within bounds', () => {
        expect(planCoinFlights(from, to, 0, seeded(), 'arc')).toHaveLength(1)
        expect(planCoinFlights(from, to, 99, seeded(), 'arc')).toHaveLength(8)
        // An unknown style falls back to the arc rather than failing.
        expect(planCoinFlights(from, to, 2, seeded(), 'nope')[0].duration).toBeGreaterThan(0)
    })

    it('never picks the same style twice in a row', () => {
        let previous = null
        const random = seeded()
        for (let i = 0; i < 200; i++) {
            const next = pickStyle(COIN_STYLE_NAMES, previous, random)
            expect(COIN_STYLE_NAMES).toContain(next)
            expect(next).not.toBe(previous)
            previous = next
        }
        expect(pickStyle(['only'], 'only')).toBe('only')
    })
})
