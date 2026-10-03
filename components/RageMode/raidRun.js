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
    beam: 22,
    wave: 16,
}

export const POINTS = {
    mail: 40,
    fighter: 120,
    chat: 90,
    ping: 60,
    note: 110,
    noteSmall: 30,
    mine: 70,
    meeting: 400,
    deadline: 1500,
    carrier: 250,
    bunker: 150,
    armoured: 300,
    pageTask: 100,
    boss: 2000,
}
// Balanced so a mission flown well pays ~600 credits early on and ~1,200 by mission 6, and the
// permanent upgrades (cannon + shield generator, ~6,700 in all) take seven or eight missions to max
// out — buying everything after two missions made every later mission trivial.
export const CREDITS = {
    mail: 3,
    fighter: 10,
    chat: 7,
    ping: 4,
    note: 8,
    noteSmall: 2,
    mine: 5,
    meeting: 30,
    deadline: 100,
    carrier: 25,
    bunker: 12,
    armoured: 25,
    pageTask: 8,
    boss: 120,
}

// Kills chained within this window build a combo; every 5 in a row adds half a point multiplier,
// up to 3x. Credits are never multiplied — the combo is for the score.
export const COMBO_WINDOW = 1.8
export const COMBO_STEP = 5
export const MAX_COMBO_MULTIPLIER = 3
export const MISSION_BONUS_CREDITS = 80

/** How much harder mission `n` (1-based) is: enemy health, fire rate and bullet speed scale with it. */
export const missionDifficulty = mission => 1 + 0.3 * Math.max(0, mission - 1)

export const createRun = ({ startShield } = {}) => ({
    mission: 1,
    score: 0,
    credits: 0,
    maxShield: BASE_MAX_SHIELD,
    shield: typeof startShield === 'number' ? Math.max(1, Math.min(BASE_MAX_SHIELD, startShield)) : BASE_MAX_SHIELD,
    bombs: START_BOMBS,
    cannonLevel: 1,
    invulnerableUntil: 0,
    combo: 0,
    comboAt: -Infinity,
    bestCombo: 0,
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

export const comboMultiplier = combo => Math.min(MAX_COMBO_MULTIPLIER, 1 + Math.floor(combo / COMBO_STEP) * 0.5)

/** The combo still alive at `now` (0 once the window has passed without a kill). */
export const currentCombo = (run, now) => (now - run.comboAt <= COMBO_WINDOW ? run.combo : 0)

/** Count a kill at `now` into the combo; returns the score multiplier it earns. */
export const registerKill = (run, now) => {
    if (now - run.comboAt > COMBO_WINDOW) run.combo = 0
    run.combo += 1
    run.comboAt = now
    run.bestCombo = Math.max(run.bestCombo, run.combo)
    return comboMultiplier(run.combo)
}

/**
 * Something was destroyed: score and credits for it. `kind` is a key of POINTS; `multiplier`
 * (combo × gold star) scales the points only.
 */
export const recordKill = (run, kind, multiplier = 1) => {
    const points = Math.round((POINTS[kind] || 0) * multiplier)
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
        price: () => 150,
        available: run => run.shield < run.maxShield,
        apply: run => {
            run.shield = Math.min(run.maxShield, run.shield + 35)
        },
    },
    {
        id: 'bomb',
        icon: '💣',
        price: () => 200,
        available: run => run.bombs < MAX_BOMBS,
        apply: run => {
            run.bombs = Math.min(MAX_BOMBS, run.bombs + 1)
        },
    },
    {
        id: 'cannon',
        icon: '🔫',
        price: run => (run.cannonLevel === 1 ? 900 : 2200),
        available: run => run.cannonLevel < MAX_CANNON_LEVEL,
        apply: run => {
            run.cannonLevel = Math.min(MAX_CANNON_LEVEL, run.cannonLevel + 1)
        },
    },
    {
        id: 'shieldMax',
        icon: '🛡️',
        // Dearer with every step: 800, 1200, 1600.
        price: run => 800 + 400 * Math.round((run.maxShield - BASE_MAX_SHIELD) / 25),
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
