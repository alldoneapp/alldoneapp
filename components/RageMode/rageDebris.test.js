import {
    createRandom,
    debrisOpacity,
    DEBRIS_FADE,
    DEBRIS_LIFE,
    launchVelocity,
    rewindPose,
    shatterRect,
    stepDebris,
    triangleArea,
} from './rageDebris'

const piece = overrides => ({
    x: 100,
    y: 100,
    z: 2,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    age: 0,
    halfHeight: 5,
    ...overrides,
})

describe('rage mode debris', () => {
    it('is deterministic for a seed', () => {
        const a = createRandom(42)
        const b = createRandom(42)
        expect([a(), a(), a()]).toEqual([b(), b(), b()])
    })

    it('throws pieces away from the impact, up, and out of the page towards the viewer', () => {
        const random = createRandom(3)
        const right = launchVelocity({ x: 120, y: 100 }, { x: 100, y: 100 }, random)
        const left = launchVelocity({ x: 80, y: 100 }, { x: 100, y: 100 }, random)
        expect(right.vx).toBeGreaterThan(0)
        expect(left.vx).toBeLessThan(0)
        expect(right.vy).toBeLessThan(0)
        expect(right.vz).toBeGreaterThan(0)
    })

    it('throws harder with more power', () => {
        const speed = power => {
            const v = launchVelocity({ x: 130, y: 100 }, { x: 100, y: 100 }, createRandom(9), power)
            return Math.hypot(v.vx, v.vy)
        }
        expect(speed(2)).toBeGreaterThan(speed(1))
    })

    it('falls under gravity', () => {
        const p = piece()
        for (let i = 0; i < 10; i++) stepDebris(p, 1 / 60, 10000)
        expect(p.vy).toBeGreaterThan(0)
        expect(p.y).toBeGreaterThan(100)
    })

    it('lands on the bottom of the viewport instead of falling through it', () => {
        const p = piece({ y: 590, vy: 900 })
        for (let i = 0; i < 240; i++) stepDebris(p, 1 / 60, 600)
        expect(p.y).toBeLessThanOrEqual(600 - p.halfHeight)
        expect(p.vy).toBe(0)
    })

    it('fades out only at the end of its life', () => {
        expect(debrisOpacity(0)).toBe(1)
        expect(debrisOpacity(DEBRIS_LIFE - DEBRIS_FADE / 2)).toBeCloseTo(0.5)
        expect(debrisOpacity(DEBRIS_LIFE + 1)).toBe(0)
    })

    it('shatters a rectangle into shards that tile it exactly', () => {
        const width = 180
        const height = 120
        const shards = shatterRect(width, height, createRandom(11))
        const area = shards.reduce((sum, shard) => sum + triangleArea(shard.vertices), 0)
        expect(shards.length).toBeGreaterThan(10)
        expect(area).toBeCloseTo(width * height, 3)
        shards.forEach(shard =>
            shard.vertices.forEach(v => {
                expect(v.x).toBeGreaterThanOrEqual(0)
                expect(v.x).toBeLessThanOrEqual(width)
                expect(v.y).toBeGreaterThanOrEqual(0)
                expect(v.y).toBeLessThanOrEqual(height)
            })
        )
    })

    it('still shatters something smaller than one shard', () => {
        const shards = shatterRect(10, 8, createRandom(1))
        expect(shards).toHaveLength(2)
        expect(shards.reduce((sum, s) => sum + triangleArea(s.vertices), 0)).toBeCloseTo(80)
    })

    it('rewinds every piece exactly back to where it came from', () => {
        const from = { x: 400, y: 580, z: 120, rx: 7, ry: -3, rz: 12 }
        const to = { x: 50, y: 60, z: 2 }
        expect(rewindPose(from, to, 0)).toEqual(expect.objectContaining({ x: 400, rx: 7 }))
        const end = rewindPose(from, to, 1)
        expect(end.x).toBeCloseTo(50)
        expect(end.y).toBeCloseTo(60)
        expect(end.z).toBeCloseTo(2)
        expect([end.rx, end.ry, end.rz]).toEqual([0, 0, 0])
        expect(rewindPose(from, to, 5)).toEqual(end)
    })
})
