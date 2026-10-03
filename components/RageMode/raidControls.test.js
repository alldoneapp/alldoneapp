import {
    directionForKey,
    dragShip,
    isBrowserShortcut,
    moveVector,
    SHIP_MAX_SPEED,
    shipBounds,
    stepShip,
} from './raidControls'

const viewport = { width: 1000, height: 800 }

describe('raid controls', () => {
    it('maps arrows and WASD to directions, and diagonals are not faster', () => {
        expect(directionForKey('KeyW')).toBe('up')
        expect(directionForKey('ArrowRight')).toBe('right')
        expect(directionForKey('KeyQ')).toBeNull()
        const diagonal = moveVector(new Set(['up', 'right']))
        expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1)
        expect(moveVector(new Set(['up', 'down']))).toEqual({ x: 0, y: 0 })
    })

    it('follows the cursor without exceeding the top speed', () => {
        const ship = { x: 500, y: 700, vx: 0 }
        stepShip(ship, { target: { x: 980, y: 700 } }, 1 / 60, viewport)
        expect(ship.x).toBeGreaterThan(500)
        expect(ship.x - 500).toBeLessThanOrEqual(SHIP_MAX_SPEED / 60 + 1e-9)
        expect(ship.vx).toBeGreaterThan(0)
        for (let i = 0; i < 120; i++) stepShip(ship, { target: { x: 600, y: 650 } }, 1 / 60, viewport)
        expect(ship.x).toBeCloseTo(600, 0)
        expect(ship.y).toBeCloseTo(650, 0)
    })

    it('never flies into the top band or off screen', () => {
        const ship = { x: 500, y: 700, vx: 0 }
        for (let i = 0; i < 200; i++) stepShip(ship, { target: { x: -500, y: -500 } }, 1 / 60, viewport)
        const bounds = shipBounds(viewport)
        expect(ship.x).toBeCloseTo(bounds.left)
        expect(ship.y).toBeCloseTo(bounds.top)
        dragShip(ship, 5000, 5000, viewport)
        expect(ship).toMatchObject({ x: bounds.right, y: bounds.bottom })
    })

    it('lets keyboard thrust override the cursor', () => {
        const ship = { x: 500, y: 600, vx: 0 }
        stepShip(ship, { target: { x: 900, y: 600 }, thrust: { x: -1, y: 0 } }, 0.1, viewport)
        expect(ship.x).toBeLessThan(500)
    })

    it('moves a touch-dragged ship by exactly the drag', () => {
        const ship = { x: 500, y: 600, vx: 0 }
        dragShip(ship, -40, 25, viewport)
        expect(ship).toMatchObject({ x: 460, y: 625 })
    })

    it('leaves browser shortcuts to the browser', () => {
        expect(isBrowserShortcut({ metaKey: true })).toBe(true)
        expect(isBrowserShortcut({ key: 'a' })).toBe(false)
    })
})
