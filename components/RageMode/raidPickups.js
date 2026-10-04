import { MAX_BOMBS } from './raidRun'

/**
 * Power-ups: what enemies drop, what each one does, and how long it lasts. Pure — the arena draws
 * the tokens, flies them down the screen and reports when Anna picks one up.
 *
 * Office life, weaponised: coffee makes her fire faster, a brainstorm fans the main gun out, the
 * assistants fly in as two helper drones, a deadline extension slows the whole enemy side down,
 * a gold star doubles the score. The rest are what a shooter needs: a shield bubble, repairs, a
 * spare mega bomb, a magnet for tokens, and a bundle of credits for the hangar.
 *
 * Timed ones stack by extending: picking up a second coffee while the first is still going adds its
 * time, up to twice a single coffee, so a lucky streak is rewarded without becoming permanent.
 */

export const PICKUP_TYPES = {
    coffee: { icon: '☕', color: '#8D6E63', duration: 8, weight: 14 },
    spread: { icon: '💡', color: '#FFB300', duration: 10, weight: 12 },
    shield: { icon: '🛡️', color: '#29B6F6', duration: 6, weight: 8 },
    repair: { icon: '🩹', color: '#EF5350', amount: 30, weight: 10 },
    bomb: { icon: '💣', color: '#546E7A', weight: 6 },
    drones: { icon: '🤖', color: '#7E57C2', duration: 12, weight: 8 },
    slowmo: { icon: '⏳', color: '#26A69A', duration: 6, weight: 7 },
    star: { icon: '⭐', color: '#FFC107', duration: 12, weight: 9 },
    magnet: { icon: '🧲', color: '#E53935', duration: 12, weight: 8 },
    credits: { icon: '💳', color: '#09A87A', amount: 8, weight: 10 },
}
export const PICKUP_IDS = Object.keys(PICKUP_TYPES)
export const PICKUP_POINTS = 25

// How likely each kind of enemy is to drop something, and how many tokens a sure drop gives.
export const DROP_CHANCE = {
    mail: 0.03,
    fighter: 0.08,
    chat: 0.08,
    ping: 0.05,
    note: 0.1,
    noteSmall: 0.03,
    mine: 0.06,
    meeting: 0.3,
    deadline: 1,
    carrier: 1,
    bunker: 0.15,
    armoured: 0.25,
    pageTask: 0.08,
    boss: 1,
}
export const DROP_COUNT = { carrier: 2, deadline: 1, boss: 2 }

// While a slow-motion pickup lasts, the enemy side runs at this share of normal speed.
export const SLOWMO_SCALE = 0.45
export const COFFEE_INTERVAL_FACTOR = 0.45
export const MAGNET_RADIUS = 280

/**
 * Which pickup to drop, weighted. A battered shield makes a repair three times as likely, and a
 * full bomb bay never drops a bomb nobody can carry.
 */
export const pickPickup = (random, run) => {
    const weights = PICKUP_IDS.map(id => {
        let weight = PICKUP_TYPES[id].weight
        if (id === 'repair' && run && run.shield < run.maxShield * 0.4) weight *= 3
        if (id === 'bomb' && run && run.bombs >= MAX_BOMBS) weight = 0
        return weight
    })
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    let roll = random() * total
    for (let i = 0; i < PICKUP_IDS.length; i++) {
        roll -= weights[i]
        if (roll < 0) return PICKUP_IDS[i]
    }
    return PICKUP_IDS[PICKUP_IDS.length - 1]
}

/** What a destroyed `kind` drops: a list of pickup ids, usually empty. */
export const rollDrops = (kind, random, run) => {
    const chance = DROP_CHANCE[kind] || 0
    if (random() >= chance) return []
    return Array.from({ length: DROP_COUNT[kind] || 1 }, () => pickPickup(random, run))
}

export const createBuffs = () => ({ until: {} })

export const isActive = (buffs, id, now) => (buffs.until[id] || 0) > now
export const remaining = (buffs, id, now) => Math.max(0, (buffs.until[id] || 0) - now)

/**
 * Anna picked up `id` at `now`. Instant ones change the run; timed ones start or extend a buff.
 * Returns what happened, for the toast: `{ id, instant, seconds }`.
 */
export const collectPickup = (buffs, run, id, now) => {
    const type = PICKUP_TYPES[id]
    if (!type) return null
    run.score += PICKUP_POINTS
    run.missionScore += PICKUP_POINTS
    if (id === 'repair') {
        run.shield = Math.min(run.maxShield, run.shield + type.amount)
        return { id, instant: true }
    }
    if (id === 'bomb') {
        run.bombs = Math.min(MAX_BOMBS, run.bombs + 1)
        return { id, instant: true }
    }
    if (id === 'credits') {
        run.credits += type.amount
        run.missionCredits += type.amount
        return { id, instant: true }
    }
    const start = Math.max(now, buffs.until[id] || 0)
    buffs.until[id] = Math.min(now + type.duration * 2, start + type.duration)
    return { id, instant: false, seconds: buffs.until[id] - now }
}

/** The buffs running at `now`, soonest to run out first: `[{ id, left, share }]`. */
export const activeBuffs = (buffs, now) =>
    PICKUP_IDS.filter(id => isActive(buffs, id, now))
        .map(id => ({
            id,
            left: remaining(buffs, id, now),
            share: remaining(buffs, id, now) / PICKUP_TYPES[id].duration,
        }))
        .sort((a, b) => a.left - b.left)

/** How fast the enemy side runs right now (a deadline extension slows it down). */
export const enemyTimeScale = (buffs, now) => (isActive(buffs, 'slowmo', now) ? SLOWMO_SCALE : 1)

/** The main gun's interval factor (coffee makes it fire faster). */
export const fireIntervalFactor = (buffs, now) => (isActive(buffs, 'coffee', now) ? COFFEE_INTERVAL_FACTOR : 1)
