/**
 * One run of the raid: everything that survives from mission to mission — shield, mega bombs, the
 * cannon upgrade, credits and score — plus the hangar's price list. Pure: the arena reports what
 * happened, this decides the numbers.
 *
 * Credits are deliberately NOT Gold. They are earned by shooting things, live only as long as the
 * run, and buy consumables in the hangar. A game that paid out Gold would let a modified client mint
 * real currency; Gold only ever flows INTO the game, through the server-side weapon shop.
 */

export const BASE_MAX_SHIELD = 100
export const SHIELD_CAP = 175
export const START_BOMBS = 2
export const MAX_BOMBS = 5
export const MAX_CANNON_LEVEL = 3
// After a hit Anna blinks and cannot be hit again for a moment, so one burst cannot empty the shield.
export const INVULNERABLE_SECONDS = 0.9

export const DAMAGE = {
    bullet: 8,
    mail: 10,
    fighter: 18,
    bossOrb: 12,
    bossContact: 20,
}

export const POINTS = { mail: 40, fighter: 120, bunker: 150, armoured: 300, pageTask: 100, boss: 2000 }
export const CREDITS = { mail: 12, fighter: 35, bunker: 45, armoured: 90, pageTask: 30, boss: 400 }
export const MISSION_BONUS_CREDITS = 150

/** How much harder mission `n` (1-based) is: enemy health, fire rate and bullet speed scale with it. */
export const missionDifficulty = mission => 1 + 0.22 * Math.max(0, mission - 1)

export const createRun = ({ startShield } = {}) => ({
    mission: 1,
    score: 0,
    credits: 0,
    maxShield: BASE_MAX_SHIELD,
    shield: typeof startShield === 'number' ? Math.max(1, Math.min(BASE_MAX_SHIELD, startShield)) : BASE_MAX_SHIELD,
    bombs: START_BOMBS,
    cannonLevel: 1,
    invulnerableUntil: 0,
    // Per mission, for the hangar's debrief.
    kills: 0,
    missionCredits: 0,
    missionScore: 0,
})

export const isBlinking = (run, now) => now < run.invulnerableUntil

/**
 * Apply `amount` damage at time `now` (seconds). Returns whether it landed and whether it was fatal;
 * a hit during the invulnerable window does nothing.
 */
export const applyDamage = (run, amount, now) => {
    if (run.shield <= 0 || now < run.invulnerableUntil) return { hit: false, dead: run.shield <= 0 }
    run.shield = Math.max(0, run.shield - amount)
    run.invulnerableUntil = now + INVULNERABLE_SECONDS
    return { hit: true, dead: run.shield <= 0 }
}

/** Something was destroyed: score and credits for it. `kind` is a key of POINTS. */
export const recordKill = (run, kind) => {
    const points = POINTS[kind] || 0
    const credits = CREDITS[kind] || 0
    run.score += points
    run.missionScore += points
    run.credits += credits
    run.missionCredits += credits
    run.kills += 1
    return { points, credits }
}

/** The bonus for clearing a mission; resets the per-mission debrief counters for the next one. */
export const completeMission = run => {
    run.credits += MISSION_BONUS_CREDITS
    run.missionCredits += MISSION_BONUS_CREDITS
    const debrief = {
        mission: run.mission,
        kills: run.kills,
        credits: run.missionCredits,
        score: run.missionScore,
        bonus: MISSION_BONUS_CREDITS,
    }
    return debrief
}

export const startNextMission = run => {
    run.mission += 1
    run.kills = 0
    run.missionCredits = 0
    run.missionScore = 0
    run.invulnerableUntil = 0
    return run
}

export const useBomb = run => {
    if (run.bombs <= 0) return false
    run.bombs -= 1
    return true
}

/**
 * The hangar between missions. `price(run)` may depend on the run (the cannon gets dearer per
 * level); `available(run)` says whether buying would change anything.
 */
export const HANGAR_ITEMS = [
    {
        id: 'repair',
        icon: '🛠️',
        price: () => 120,
        available: run => run.shield < run.maxShield,
        apply: run => {
            run.shield = Math.min(run.maxShield, run.shield + 35)
        },
    },
    {
        id: 'bomb',
        icon: '💣',
        price: () => 180,
        available: run => run.bombs < MAX_BOMBS,
        apply: run => {
            run.bombs = Math.min(MAX_BOMBS, run.bombs + 1)
        },
    },
    {
        id: 'cannon',
        icon: '🔫',
        price: run => (run.cannonLevel === 1 ? 450 : 1100),
        available: run => run.cannonLevel < MAX_CANNON_LEVEL,
        apply: run => {
            run.cannonLevel = Math.min(MAX_CANNON_LEVEL, run.cannonLevel + 1)
        },
    },
    {
        id: 'shieldMax',
        icon: '🛡️',
        price: () => 700,
        available: run => run.maxShield < SHIELD_CAP,
        apply: run => {
            run.maxShield = Math.min(SHIELD_CAP, run.maxShield + 25)
            run.shield = Math.min(run.maxShield, run.shield + 25)
        },
    },
]

export const hangarItem = id => HANGAR_ITEMS.find(item => item.id === id) || null

/** Buy `id` with credits. Returns `{ ok, reason }`; nothing changes unless it is ok. */
export const buyHangarItem = (run, id) => {
    const item = hangarItem(id)
    if (!item) return { ok: false, reason: 'unknown' }
    if (!item.available(run)) return { ok: false, reason: 'maxed' }
    const price = item.price(run)
    if (run.credits < price) return { ok: false, reason: 'credits' }
    run.credits -= price
    item.apply(run)
    return { ok: true, price }
}
