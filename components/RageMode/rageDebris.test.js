import { createRandom, shatterRect, triangleArea } from './rageDebris'

describe('rage mode debris', () => {
    it('is deterministic for a seed', () => {
        const a = createRandom(42)
        const b = createRandom(42)
        expect([a(), a(), a()]).toEqual([b(), b(), b()])
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
})
