import { createRandom } from './rageDebris'
import {
    chooseDirection,
    createSnake,
    pointAlongTrail,
    segmentPositions,
    shrinkSnake,
    SNAKE_GAP,
    SNAKE_MIN_SCALE,
    SNAKE_SHRINK,
    stepSnake,
} from './rageSnake'

const bounds = { left: 0, top: 60, right: 1200, bottom: 800 }

describe('task snakes', () => {
    it('starts lying along its title, heading on in reading direction', () => {
        const snake = createSnake({ head: { x: 400, y: 300 }, tail: { x: 200, y: 300 }, segmentCount: 8 })
        expect(snake.dir).toEqual({ x: 1, y: 0 })
        const positions = segmentPositions(snake, 8)
        expect(positions[0]).toEqual({ x: 400, y: 300 })
        expect(positions[1].x).toBeCloseTo(400 - SNAKE_GAP)
        positions.forEach(p => expect(p.y).toBe(300))
    })

    it('walks a polyline by arc length, corners included', () => {
        const trail = [
            { x: 10, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 10 },
        ]
        expect(pointAlongTrail(trail, 5)).toEqual({ x: 5, y: 0 })
        expect(pointAlongTrail(trail, 15)).toEqual({ x: 0, y: 5 })
        expect(pointAlongTrail(trail, 99)).toEqual({ x: 0, y: 10 })
    })

    it('moves only along grid axes and its body retraces the corners', () => {
        const random = createRandom(4)
        const snake = createSnake({ head: { x: 600, y: 400 }, tail: { x: 450, y: 400 }, segmentCount: 10 })
        for (let i = 0; i < 600; i++) stepSnake(snake, 1 / 60, bounds, random, 10)
        expect(Math.abs(snake.dir.x) + Math.abs(snake.dir.y)).toBe(1)
        for (let i = 1; i < snake.trail.length - 1; i++) {
            const a = snake.trail[i - 1]
            const b = snake.trail[i]
            // Every trail edge is horizontal or vertical.
            expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(1e-6)
        }
    })

    it('never leaves the play area', () => {
        const random = createRandom(9)
        const snake = createSnake({ head: { x: 1150, y: 750 }, tail: { x: 1000, y: 750 }, segmentCount: 6 })
        for (let i = 0; i < 3000; i++) {
            stepSnake(snake, 1 / 60, bounds, random, 6)
            expect(snake.head.x).toBeGreaterThanOrEqual(bounds.left - 60)
            expect(snake.head.x).toBeLessThanOrEqual(bounds.right + 60)
            expect(snake.head.y).toBeGreaterThanOrEqual(bounds.top - 60)
            expect(snake.head.y).toBeLessThanOrEqual(bounds.bottom + 60)
        }
    })

    it('turns away from a wall instead of running into it', () => {
        const snake = createSnake({ head: { x: 1195, y: 400 }, tail: { x: 1100, y: 400 }, segmentCount: 4 })
        const next = chooseDirection(snake, bounds, () => 0.99)
        expect(next.x).toBe(0)
    })

    it('never reverses into itself when it can turn', () => {
        const random = createRandom(2)
        const snake = createSnake({ head: { x: 600, y: 400 }, tail: { x: 500, y: 400 }, segmentCount: 4 })
        for (let i = 0; i < 50; i++) {
            const next = chooseDirection(snake, bounds, random)
            expect(next.x === -snake.dir.x && next.y === -snake.dir.y).toBe(false)
        }
    })

    it('gets smaller with every hit and bursts in the end', () => {
        const snake = createSnake({ head: { x: 600, y: 400 }, tail: { x: 500, y: 400 }, segmentCount: 12 })
        let segments = 12
        let hits = 0
        let result = { dead: false }
        while (!result.dead) {
            segments -= 1
            hits += 1
            result = shrinkSnake(snake, segments)
        }
        expect(snake.scale).toBeLessThan(1)
        expect(hits).toBe(Math.ceil(Math.log(SNAKE_MIN_SCALE) / Math.log(SNAKE_SHRINK)))
    })

    it('dies when only its head is left', () => {
        const snake = createSnake({ head: { x: 600, y: 400 }, tail: { x: 580, y: 400 }, segmentCount: 2 })
        expect(shrinkSnake(snake, 1).dead).toBe(true)
    })

    it('speeds up as it shrinks', () => {
        const fresh = createSnake({ head: { x: 300, y: 400 }, tail: { x: 200, y: 400 }, segmentCount: 4 })
        const wounded = createSnake({ head: { x: 300, y: 400 }, tail: { x: 200, y: 400 }, segmentCount: 4 })
        wounded.scale = 0.5
        stepSnake(fresh, 0.1, bounds, () => 0.99, 4)
        stepSnake(wounded, 0.1, bounds, () => 0.99, 4)
        expect(Math.abs(wounded.head.x - 300)).toBeGreaterThan(Math.abs(fresh.head.x - 300))
    })
})
