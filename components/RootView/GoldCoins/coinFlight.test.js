import { COIN_STAGGER, coinPositionAt, planCoinFlights } from './coinFlight'

const from = { x: 300, y: 500 }
const to = { x: 900, y: 40 }
const fixed = () => 0.5

describe('gold coin flight', () => {
    it('plans one coin per gold earned, launched one after another', () => {
        const flights = planCoinFlights(from, to, 4, fixed)
        expect(flights).toHaveLength(4)
        expect(flights.map(f => f.delay)).toEqual([0, 1, 2, 3].map(i => i * COIN_STAGGER))
        expect(planCoinFlights(from, to, 0, fixed)).toHaveLength(1)
        expect(planCoinFlights(from, to, 99, fixed)).toHaveLength(8)
    })

    it('starts at the checkbox, pops out, arcs above the straight line and lands in the counter', () => {
        const [flight] = planCoinFlights(from, to, 1, fixed)
        expect(coinPositionAt(flight, -0.1).started).toBe(false)
        const start = coinPositionAt(flight, 0)
        expect(start).toMatchObject({ started: true, landed: false, x: from.x, y: from.y })
        // Mid-flight it is above the straight line between the two points.
        const middle = coinPositionAt(flight, flight.duration * 0.6)
        const lineY = from.y + ((middle.x - from.x) / (to.x - from.x)) * (to.y - from.y)
        expect(middle.y).toBeLessThan(lineY)
        expect(middle.scale).toBeGreaterThan(0.7)
        const end = coinPositionAt(flight, flight.duration + 0.01)
        expect(end).toMatchObject({ landed: true, x: to.x, y: to.y })
    })

    it('keeps each flight short and bounded', () => {
        const near = planCoinFlights({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, fixed)[0]
        const far = planCoinFlights({ x: 0, y: 0 }, { x: 4000, y: 3000 }, 1, fixed)[0]
        expect(near.duration).toBeGreaterThanOrEqual(0.75)
        expect(far.duration).toBeLessThanOrEqual(1.25)
    })
})
