import {
    BOSS_AT,
    buildMission,
    CHUNK_HEIGHT,
    daySeed,
    MIN_BUNKERS,
    MAX_BUNKERS,
    MAX_SPEEDUP,
    missionScrollSpeed,
    missionWaves,
    RIVER_HALF_WIDTH,
    riverX,
    SCROLL_SPEED,
    terrainChunk,
} from './raidLevel'

const tasks = ['Reply to the tax advisor', 'Prepare the board slides', 'Fix the flaky login test'].map(label => ({
    label,
    color: '#0C66FF',
}))

describe('raid level', () => {
    it('is the same level all day and a new one tomorrow', () => {
        expect(daySeed(new Date(2026, 9, 3, 8))).toBe(daySeed(new Date(2026, 9, 3, 23)))
        expect(daySeed(new Date(2026, 9, 4))).not.toBe(daySeed(new Date(2026, 9, 3)))
        const a = buildMission({ mission: 1, seed: 20261003, tasks, width: 1200 })
        const b = buildMission({ mission: 1, seed: 20261003, tasks, width: 1200 })
        expect(a).toEqual(b)
    })

    it('introduces the cast in mission 1, one wave at a time, before the boss', () => {
        const waves = missionWaves(1, 5)
        const types = new Set(waves.map(wave => wave.type))
        ;['fighter', 'mail', 'chat', 'ping', 'carrier', 'note', 'mine'].forEach(type =>
            expect(types.has(type)).toBe(true)
        )
        waves.forEach(wave => expect(wave.at).toBeLessThan(BOSS_AT - 8))
        expect(waves.map(wave => wave.at)).toEqual([...waves.map(wave => wave.at)].sort((x, y) => x - y))
    })

    it('unlocks meetings in mission 2 and the deadline in mission 3, and always sends a carrier', () => {
        for (let seed = 1; seed < 30; seed++) {
            const second = new Set(missionWaves(2, seed).map(wave => wave.type))
            expect(second.has('meeting')).toBe(true)
            expect(second.has('note')).toBe(true)
            expect(second.has('mine')).toBe(true)
            expect(second.has('deadline')).toBe(false)
            const third = missionWaves(3, seed)
            const deadline = third.find(wave => wave.type === 'deadline')
            expect(deadline).toBeTruthy()
            // A mini-boss in the middle of the mission, not at its start or end.
            expect(deadline.at).toBeGreaterThan(20)
            expect(deadline.at).toBeLessThan(50)
            ;[1, 2, 3, 6].forEach(mission =>
                expect(missionWaves(mission, seed).filter(wave => wave.type === 'carrier')).toHaveLength(1)
            )
        }
    })

    it('draws later missions from the day, with bigger flights, all before the boss', () => {
        expect(missionWaves(4, 9)).toEqual(missionWaves(4, 9))
        expect(missionWaves(4, 9)).not.toEqual(missionWaves(4, 10))
        const total = mission => missionWaves(mission, 9).reduce((sum, wave) => sum + wave.count, 0)
        expect(total(5)).toBeGreaterThan(total(2))
        ;[2, 3, 7].forEach(mission =>
            missionWaves(mission, 9).forEach(wave => expect(wave.at).toBeLessThan(BOSS_AT - 4))
        )
    })

    it("digs today's tasks in as labelled bunkers, padding a short list", () => {
        const { bunkers } = buildMission({ mission: 1, seed: 3, tasks, width: 1200 })
        expect(bunkers).toHaveLength(MIN_BUNKERS)
        expect(bunkers.slice(0, 3).map(b => b.label)).toEqual(tasks.map(t => t.label))
        expect(bunkers.slice(3).every(b => b.label === '')).toBe(true)
        const many = Array.from({ length: 40 }, (_, i) => ({ label: `Task ${i}` }))
        expect(buildMission({ seed: 3, tasks: many, width: 1200 }).bunkers).toHaveLength(MAX_BUNKERS)
    })

    it.each([390, 800, 1440])('never puts a bunker in the river (width %i)', width => {
        for (let seed = 1; seed < 40; seed++) {
            buildMission({ seed, tasks, width }).bunkers.forEach(bunker => {
                const river = riverX(bunker.g, width, seed)
                expect(Math.abs(bunker.x - river)).toBeGreaterThan(RIVER_HALF_WIDTH + bunker.w / 2)
                expect(bunker.x - bunker.w / 2).toBeGreaterThanOrEqual(0)
                expect(bunker.x + bunker.w / 2).toBeLessThanOrEqual(width)
            })
        }
    })

    it('places the bunkers along the route, in order', () => {
        const { bunkers, scrollSpeed } = buildMission({ seed: 8, tasks, width: 1000 })
        const gs = bunkers.map(b => b.g)
        expect(gs).toEqual([...gs].sort((x, y) => x - y))
        expect(gs[gs.length - 1]).toBeLessThan(BOSS_AT * scrollSpeed)
    })

    it('scrolls faster mission by mission, up to a cap, and stretches the route to match', () => {
        expect(missionScrollSpeed(2)).toBeGreaterThan(missionScrollSpeed(1))
        expect(missionScrollSpeed(4)).toBeGreaterThan(missionScrollSpeed(3))
        expect(missionScrollSpeed(50)).toBe(Math.round(SCROLL_SPEED * MAX_SPEEDUP))
        const first = buildMission({ mission: 1, seed: 8, tasks, width: 1000 })
        const fifth = buildMission({ mission: 5, seed: 8, tasks, width: 1000 })
        expect(fifth.scrollSpeed).toBeGreaterThan(first.scrollSpeed)
        expect(fifth.bunkers[fifth.bunkers.length - 1].g).toBeGreaterThan(first.bunkers[first.bunkers.length - 1].g)
    })

    it('keeps the river on screen', () => {
        for (let g = 0; g < 20000; g += 97) {
            const x = riverX(g, 1000, 12345)
            expect(x).toBeGreaterThanOrEqual(140)
            expect(x).toBeLessThanOrEqual(860)
        }
    })

    it('builds the same scenery for the same chunk, inside the chunk', () => {
        const a = terrainChunk({ index: 4, width: 1000, seed: 77 })
        expect(terrainChunk({ index: 4, width: 1000, seed: 77 })).toEqual(a)
        expect(a.fields.length).toBeGreaterThan(0)
        ;[...a.trees, ...a.houses].forEach(thing => {
            expect(thing.y).toBeGreaterThanOrEqual(0)
            expect(thing.y).toBeLessThanOrEqual(CHUNK_HEIGHT)
            const river = riverX(4 * CHUNK_HEIGHT + thing.y, 1000, 77)
            expect(Math.abs(thing.x - river)).toBeGreaterThan(RIVER_HALF_WIDTH)
        })
    })
})
