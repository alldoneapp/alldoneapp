import {
    applyDamage,
    BASE_MAX_SHIELD,
    buyHangarItem,
    COMBO_WINDOW,
    comboMultiplier,
    completeMission,
    currentCombo,
    createRun,
    CREDITS,
    INVULNERABLE_SECONDS,
    MAX_BOMBS,
    MAX_CANNON_LEVEL,
    MISSION_BONUS_CREDITS,
    missionDifficulty,
    recordKill,
    registerKill,
    SHIELD_CAP,
    startNextMission,
    useBomb,
} from './raidRun'
import { buildMission } from './raidLevel'
import { expandWave } from './raidEnemies'

describe('raid run', () => {
    it('starts on mission 1 with a full shield, two bombs and no credits', () => {
        const run = createRun()
        expect(run).toMatchObject({ mission: 1, shield: BASE_MAX_SHIELD, bombs: 2, credits: 0, cannonLevel: 1 })
    })

    it('clamps a tuned start shield into a living range', () => {
        expect(createRun({ startShield: 0 }).shield).toBe(1)
        expect(createRun({ startShield: 500 }).shield).toBe(BASE_MAX_SHIELD)
    })

    it('ignores hits during the invulnerable window and reports the fatal one', () => {
        const run = createRun({ startShield: 20 })
        expect(applyDamage(run, 12, 1)).toEqual({ hit: true, dead: false })
        expect(applyDamage(run, 12, 1 + INVULNERABLE_SECONDS / 2)).toEqual({ hit: false, dead: false })
        expect(run.shield).toBe(8)
        expect(applyDamage(run, 12, 1 + INVULNERABLE_SECONDS + 0.01)).toEqual({ hit: true, dead: true })
        expect(run.shield).toBe(0)
        expect(applyDamage(run, 12, 10)).toEqual({ hit: false, dead: true })
    })

    it('pays score and credits per kill and sums them into the mission debrief', () => {
        const run = createRun()
        recordKill(run, 'fighter')
        recordKill(run, 'mail')
        const debrief = completeMission(run)
        expect(debrief).toEqual({
            mission: 1,
            kills: 2,
            credits: CREDITS.fighter + CREDITS.mail + MISSION_BONUS_CREDITS,
            score: run.score,
            bonus: MISSION_BONUS_CREDITS,
        })
        startNextMission(run)
        expect(run).toMatchObject({ mission: 2, kills: 0, missionCredits: 0, missionScore: 0 })
        expect(run.credits).toBe(debrief.credits)
    })

    it('builds a combo from quick kills and multiplies the points, never the credits', () => {
        const run = createRun()
        let multiplier = 1
        for (let i = 0; i < 10; i++) multiplier = registerKill(run, i * 0.5)
        expect(run.combo).toBe(10)
        expect(multiplier).toBe(2)
        recordKill(run, 'fighter', multiplier)
        expect(run.score).toBe(240)
        expect(run.credits).toBe(CREDITS.fighter)
        expect(currentCombo(run, 4.5 + COMBO_WINDOW + 0.1)).toBe(0)
        registerKill(run, 4.5 + COMBO_WINDOW + 0.1)
        expect(run.combo).toBe(1)
        expect(run.bestCombo).toBe(10)
        expect(comboMultiplier(1000)).toBe(3)
    })

    it('gets harder mission by mission', () => {
        expect(missionDifficulty(1)).toBe(1)
        expect(missionDifficulty(3)).toBeGreaterThan(missionDifficulty(2))
    })

    it('spends bombs until there are none', () => {
        const run = createRun()
        expect(useBomb(run)).toBe(true)
        expect(useBomb(run)).toBe(true)
        expect(useBomb(run)).toBe(false)
        expect(run.bombs).toBe(0)
    })

    describe('hangar', () => {
        it('refuses a purchase it cannot afford and changes nothing', () => {
            const run = createRun()
            run.credits = 10
            expect(buyHangarItem(run, 'bomb')).toEqual({ ok: false, reason: 'credits' })
            expect(run).toMatchObject({ credits: 10, bombs: 2 })
        })

        it('charges credits and applies the item', () => {
            const run = createRun({ startShield: 40 })
            run.credits = 1000
            expect(buyHangarItem(run, 'repair').ok).toBe(true)
            expect(run.shield).toBe(75)
            expect(buyHangarItem(run, 'bomb').ok).toBe(true)
            expect(run.bombs).toBe(3)
            expect(run.credits).toBe(1000 - 60 - 80)
        })

        it('stops selling what is already maxed', () => {
            const run = createRun()
            run.credits = 100000
            expect(buyHangarItem(run, 'repair')).toEqual({ ok: false, reason: 'maxed' })
            while (run.bombs < MAX_BOMBS) buyHangarItem(run, 'bomb')
            expect(buyHangarItem(run, 'bomb').reason).toBe('maxed')
            expect(buyHangarItem(run, 'cannon').price).toBe(3000)
            expect(buyHangarItem(run, 'cannon').price).toBe(7000)
            expect(run.cannonLevel).toBe(MAX_CANNON_LEVEL)
            expect(buyHangarItem(run, 'cannon').reason).toBe('maxed')
            expect([1, 2, 3].map(() => buyHangarItem(run, 'shieldMax').price)).toEqual([2500, 3500, 4500])
            expect(run.maxShield).toBe(SHIELD_CAP)
            expect(buyHangarItem(run, 'shieldMax').reason).toBe('maxed')
            expect(buyHangarItem(run, 'nope').reason).toBe('unknown')
        })
    })

    describe('balance', () => {
        // Every kill of a whole mission, plus the bonus — what a perfect pilot earns.
        const perfectMissionCredits = mission => {
            const tasks = Array.from({ length: 12 }, (_, i) => ({ label: `t${i}` }))
            const level = buildMission({ mission, seed: 20261004, tasks, width: 1280 })
            const kills = level.waves.flatMap(wave => expandWave(wave, { width: 1280, height: 800 }))
            return (
                kills.reduce((sum, enemy) => sum + (CREDITS[enemy.type] || 0), 0) +
                level.bunkers.length * CREDITS.bunker +
                CREDITS.boss +
                MISSION_BONUS_CREDITS
            )
        }
        const permanentUpgradesCost = () => {
            const run = createRun()
            run.credits = 1e9
            let spent = 0
            ;['cannon', 'shieldMax'].forEach(id => {
                for (let result = buyHangarItem(run, id); result.ok; result = buyHangarItem(run, id))
                    spent += result.price
            })
            return spent
        }

        it('takes about a hundred games to buy every upgrade', () => {
            expect(perfectMissionCredits(1)).toBeGreaterThan(150)
            expect(perfectMissionCredits(1)).toBeLessThan(400)
            // Even flawless flying, cleared mission after cleared mission, needs dozens of them …
            const flawless = permanentUpgradesCost() / perfectMissionCredits(6)
            expect(flawless).toBeGreaterThan(35)
            // … and an ordinary game, earning about half of a perfect one, about a hundred.
            const ordinary = permanentUpgradesCost() / (perfectMissionCredits(6) * 0.45)
            expect(ordinary).toBeGreaterThan(80)
            expect(ordinary).toBeLessThan(130)
        })

        it('keeps getting harder, by a little less each mission', () => {
            const step = mission => missionDifficulty(mission + 1) - missionDifficulty(mission)
            expect(missionDifficulty(2)).toBeCloseTo(1.3)
            for (let mission = 1; mission < 200; mission++) expect(step(mission)).toBeGreaterThan(0)
            expect(step(50)).toBeLessThan(step(5))
            expect(missionDifficulty(100)).toBeLessThan(1 + 0.3 * 99)
        })
    })
})
