import {
    attentionFor,
    createInteraction,
    DRAG_RADIANS_PER_PIXEL,
    MAX_BOOST,
    POKE_BOOST,
    pressEnd,
    pressMove,
    pressStart,
    setHovering,
    stepInteraction,
} from './thinkingInteraction'

const SIZE = 64
const run = (state, seconds, pointer = null) => {
    let result
    for (let t = 0; t < seconds; t += 1 / 60) result = stepInteraction(state, 1 / 60, pointer, SIZE)
    return result
}

describe('thinking interaction', () => {
    test('notices a cursor a few stage sizes away, fully when it is close, not at all far away', () => {
        expect(attentionFor(0, 0, SIZE)).toBe(1)
        expect(attentionFor(30, 0, SIZE)).toBe(1)
        const near = attentionFor(90, 0, SIZE)
        expect(near).toBeGreaterThan(0)
        expect(near).toBeLessThan(1)
        expect(attentionFor(400, 0, SIZE)).toBe(0)
        expect(attentionFor(null, null, SIZE)).toBe(0)
    })

    test('turns towards the cursor, and back once it leaves', () => {
        const state = createInteraction()
        const right = run(state, 1, { dx: 60, dy: 0 })
        expect(right.yaw).toBeGreaterThan(0.2)
        const below = run(state, 1, { dx: 0, dy: 60 })
        expect(below.pitch).toBeGreaterThan(0.2)
        expect(Math.abs(below.yaw)).toBeLessThan(0.05)
        const gone = run(state, 2, null)
        expect(Math.abs(gone.yaw) + Math.abs(gone.pitch)).toBeLessThan(0.01)
    })

    test('grows a little while hovered', () => {
        const state = createInteraction()
        setHovering(state, true)
        expect(run(state, 1).scaleX).toBeGreaterThan(1.05)
        setHovering(state, false)
        expect(run(state, 1).scaleX).toBeCloseTo(1, 2)
    })

    test('a press that barely moves is a poke; one that travels is a drag', () => {
        const poked = createInteraction()
        pressStart(poked, 10, 10, 0)
        pressMove(poked, 12, 11, 16)
        expect(pressEnd(poked, 32)).toBe(true)
        expect(poked.pokes).toBe(1)

        const dragged = createInteraction()
        pressStart(dragged, 10, 10, 0)
        pressMove(dragged, 50, 10, 16)
        expect(pressEnd(dragged, 32)).toBe(false)
        expect(dragged.pokes).toBe(0)
        expect(dragged.spinYaw).toBeCloseTo(40 * DRAG_RADIANS_PER_PIXEL)
    })

    test('a fling keeps spinning, slows down, and comes back upright', () => {
        const state = createInteraction()
        pressStart(state, 0, 0, 0)
        for (let i = 1; i <= 5; i++) pressMove(state, i * 20, i * 8, i * 16)
        pressEnd(state, 5 * 16 + 10)
        const releasedYaw = state.spinYaw
        const soon = run(state, 0.3)
        expect(soon.yaw).toBeGreaterThan(releasedYaw)
        run(state, 6)
        expect(Math.abs(state.velocityYaw)).toBeLessThan(0.01)
        expect(Math.abs(state.spinPitch)).toBeLessThan(0.02)
        // It settles facing front again, a whole number of turns from where it started.
        const turns = state.spinYaw / (Math.PI * 2)
        expect(Math.abs(turns - Math.round(turns))).toBeLessThan(0.02)
    })

    test('letting go after holding still does not fling', () => {
        const state = createInteraction()
        pressStart(state, 0, 0, 0)
        pressMove(state, 60, 0, 16)
        pressEnd(state, 600)
        expect(state.velocityYaw).toBe(0)
        const yaw = state.spinYaw
        run(state, 1)
        // No fling: it only turns back home, never further away.
        expect(Math.abs(state.spinYaw)).toBeLessThan(Math.abs(yaw))
    })

    test('pokes speed the scene up, stack when rapid, cap out and wear off', () => {
        const state = createInteraction()
        const idle = run(state, 1)
        expect(idle.timeBoost).toBe(0)
        for (let i = 0; i < 10; i++) {
            pressStart(state, 0, 0, i)
            pressEnd(state, i)
        }
        expect(state.boost).toBe(MAX_BOOST)
        expect(MAX_BOOST).toBeLessThan(POKE_BOOST * 10)
        const busy = run(state, 0.5)
        expect(busy.timeBoost).toBeGreaterThan(1)
        expect(busy.fx.sincePoke).toBeCloseTo(0.5, 1)
        const later = run(state, 6)
        expect(later.fx.energy).toBeLessThan(0.01)
        // The time it earned is kept: the scene never jumps backwards when the boost wears off.
        expect(later.timeBoost).toBeGreaterThanOrEqual(busy.timeBoost)
    })

    test('a poke squashes and stretches, then settles', () => {
        const state = createInteraction()
        pressStart(state, 0, 0, 0)
        pressEnd(state, 0)
        const scales = []
        for (let i = 0; i < 60; i++) scales.push(stepInteraction(state, 1 / 60, null, SIZE).scaleY)
        expect(Math.min(...scales)).toBeLessThan(0.95)
        expect(Math.max(...scales)).toBeGreaterThan(1.03)
        expect(scales[scales.length - 1]).toBeCloseTo(1, 1)
    })

    test('a stalled frame cannot make anything jump', () => {
        const state = createInteraction()
        pressStart(state, 0, 0, 0)
        pressMove(state, 100, 0, 16)
        pressEnd(state, 20)
        const before = state.spinYaw
        stepInteraction(state, 30, null, SIZE)
        expect(state.spinYaw - before).toBeLessThan(Math.abs(state.velocityYaw) * 0.06 + 1)
    })
})
