import {
    applyDamage,
    BASE_MAX_SHIELD,
    buyHangarItem,
    completeMission,
    createRun,
    CREDITS,
    INVULNERABLE_SECONDS,
    MAX_BOMBS,
    MAX_CANNON_LEVEL,
    MISSION_BONUS_CREDITS,
    missionDifficulty,
    recordKill,
    SHIELD_CAP,
    startNextMission,
    useBomb,
} from './raidRun'

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
            expect(run.credits).toBe(1000 - 120 - 180)
        })

        it('stops selling what is already maxed', () => {
            const run = createRun()
            run.credits = 100000
            expect(buyHangarItem(run, 'repair')).toEqual({ ok: false, reason: 'maxed' })
            while (run.bombs < MAX_BOMBS) buyHangarItem(run, 'bomb')
            expect(buyHangarItem(run, 'bomb').reason).toBe('maxed')
            expect(buyHangarItem(run, 'cannon').price).toBe(450)
            expect(buyHangarItem(run, 'cannon').price).toBe(1100)
            expect(run.cannonLevel).toBe(MAX_CANNON_LEVEL)
            expect(buyHangarItem(run, 'cannon').reason).toBe('maxed')
            while (run.maxShield < SHIELD_CAP) buyHangarItem(run, 'shieldMax')
            expect(run.maxShield).toBe(SHIELD_CAP)
            expect(buyHangarItem(run, 'shieldMax').reason).toBe('maxed')
            expect(buyHangarItem(run, 'nope').reason).toBe('unknown')
        })
    })
})
