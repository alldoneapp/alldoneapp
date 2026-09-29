import {
    aimAngle,
    directionForKey,
    isBrowserShortcut,
    MAX_SPEED,
    moveVector,
    stepCharacter,
    TOUCH_STANDOFF,
    touchHoverTarget,
} from './rageControls'

const viewport = { width: 1200, height: 800 }
const hero = overrides => ({ x: 600, y: 400, vx: 0, vy: 0, ...overrides })

describe('rage mode controls', () => {
    it('maps WASD and the arrow keys to directions', () => {
        expect(directionForKey('KeyA')).toBe('left')
        expect(directionForKey('ArrowRight')).toBe('right')
        expect(directionForKey('KeyW')).toBe('up')
        expect(directionForKey('ArrowDown')).toBe('down')
        expect(directionForKey('KeyQ')).toBeNull()
    })

    it('does not fly faster diagonally', () => {
        const diagonal = moveVector(new Set(['up', 'right']))
        expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1)
        expect(diagonal.x).toBeGreaterThan(0)
        expect(diagonal.y).toBeLessThan(0)
        expect(moveVector(new Set(['left', 'right']))).toEqual({ x: 0, y: 0 })
    })

    it('accelerates with thrust and never exceeds the top speed', () => {
        // From the far left, so a second of full thrust cannot reach the wall (which zeroes vx).
        const h = hero({ x: 40 })
        for (let i = 0; i < 60; i++) stepCharacter(h, { thrust: { x: 1, y: 0 }, seek: null }, 1 / 60, viewport)
        expect(h.vx).toBeGreaterThan(0)
        expect(Math.hypot(h.vx, h.vy)).toBeLessThanOrEqual(MAX_SPEED + 1e-6)
    })

    it('stays on screen', () => {
        const h = hero({ x: 1190, vx: 600 })
        for (let i = 0; i < 60; i++) stepCharacter(h, { thrust: { x: 1, y: 0 }, seek: null }, 1 / 60, viewport)
        expect(h.x).toBeLessThanOrEqual(viewport.width)
    })

    it('drifts to a stop without input', () => {
        const h = hero({ vx: 400 })
        for (let i = 0; i < 180; i++) stepCharacter(h, { thrust: null, seek: null }, 1 / 60, viewport)
        expect(Math.abs(h.vx)).toBeLessThan(5)
    })

    it('flies to a seek target and settles there', () => {
        const h = hero()
        const target = { x: 300, y: 200 }
        for (let i = 0; i < 240; i++) stepCharacter(h, { thrust: null, seek: target }, 1 / 60, viewport)
        expect(h.x).toBeCloseTo(300, 0)
        expect(h.y).toBeCloseTo(200, 0)
    })

    it('hovers a stand-off away from the finger on touch, on the side it came from', () => {
        const target = touchHoverTarget(hero({ x: 600, y: 600 }), { x: 600, y: 300 }, viewport)
        expect(target.x).toBeCloseTo(600)
        expect(target.y).toBeCloseTo(300 + TOUCH_STANDOFF)
    })

    it('measures aim in screen space', () => {
        expect(aimAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0)
        expect(aimAngle({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2)
    })

    it('leaves browser shortcuts to the browser', () => {
        expect(isBrowserShortcut({ metaKey: true })).toBe(true)
        expect(isBrowserShortcut({ ctrlKey: true })).toBe(true)
        expect(isBrowserShortcut({})).toBe(false)
    })
})
