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

    it('flies six scripted waves before the boss', () => {
        const waves = missionWaves(1, 5)
        const groups = new Set(waves.map(wave => Math.floor(wave.at / 10)))
        expect(groups.size).toBe(6)
        waves.forEach(wave => expect(wave.at).toBeLessThan(BOSS_AT - 8))
        expect(waves.map(wave => wave.at)).toEqual([...waves.map(wave => wave.at)].sort((x, y) => x - y))
    })

    it('reshuffles and grows the flights in later missions, keeping the timing', () => {
        const first = missionWaves(1, 9)
        const third = missionWaves(3, 9)
        expect(third.length).toBe(first.length)
        expect(third.reduce((sum, w) => sum + w.count, 0)).toBeGreaterThan(first.reduce((sum, w) => sum + w.count, 0))
        expect(third[third.length - 1].at).toBeLessThan(BOSS_AT)
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
