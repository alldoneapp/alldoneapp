/**
 * Rage mode's weapons: how each one fires, and what it costs in the shop.
 *
 * The price here is for DISPLAY. The server's copy (`functions/RageMode/rageWeaponsCatalog.js`) is
 * the one that charges, and `rageWeapons.test.js` fails the build if the two disagree. Functions
 * code cannot enter the web bundle, hence the two copies.
 *
 * `kind` picks the firing code in the arena:
 *   bolt       straight projectiles (`pellets` of them, fanned over `spread` radians)
 *   rocket     a slow projectile that explodes over `blast` px
 *   flame      a short-lived cone of flame particles, `range` px long
 *   laser      a hitscan beam that burns along its whole length while held
 *   blackhole  a projectile that stops, pulls everything within `blast` px in, then implodes
 *   snap       the ultimate: dusts a share of the visible text and hits every enemy on screen
 * `damage` is per hit: text within `radius` is knocked out, a snake loses that many tiles
 * (fractions accumulate), the boss loses that much health.
 */
export const RAGE_DEFAULT_WEAPON = 'blaster'

export const RAGE_WEAPONS = [
    { id: 'blaster', price: 0, icon: '🔫', kind: 'bolt', interval: 0.12, speed: 1500, radius: 17, damage: 1 },
    {
        id: 'shotgun',
        price: 100,
        icon: '💥',
        kind: 'bolt',
        interval: 0.55,
        speed: 1300,
        radius: 14,
        damage: 1,
        pellets: 6,
        spread: 0.34,
        range: 560,
    },
    {
        id: 'rocket',
        price: 250,
        icon: '🚀',
        kind: 'rocket',
        interval: 0.7,
        speed: 720,
        radius: 14,
        damage: 5,
        blast: 80,
    },
    {
        id: 'flamethrower',
        price: 400,
        icon: '🔥',
        kind: 'flame',
        interval: 0.03,
        speed: 560,
        radius: 16,
        damage: 0.3,
        spread: 0.28,
        range: 240,
    },
    { id: 'laser', price: 600, icon: '⚡', kind: 'laser', interval: 0.05, radius: 9, damage: 0.45, range: 2400 },
    {
        id: 'blackhole',
        price: 1000,
        icon: '🌀',
        kind: 'blackhole',
        interval: 2.2,
        speed: 620,
        radius: 14,
        damage: 14,
        blast: 140,
        travel: 0.45,
        pull: 1.3,
    },
    { id: 'snap', price: 2000, icon: '🫰', kind: 'snap', interval: 12, radius: 20, damage: 30, share: 0.45 },
]

export const weaponById = id => RAGE_WEAPONS.find(weapon => weapon.id === id) || RAGE_WEAPONS[0]

/** The angles a volley leaves at: `pellets` of them fanned evenly around `angle`. */
export const volleyAngles = (weapon, angle) => {
    const pellets = weapon.pellets || 1
    if (pellets === 1) return [angle]
    const spread = weapon.spread || 0
    return Array.from({ length: pellets }, (_, i) => angle - spread / 2 + (spread * i) / (pellets - 1))
}

/** Sample points covering a disc, for area damage (a rocket blast, a black hole). */
export const blastPoints = (centre, blast, rings = 2, perRing = 8) => {
    const points = [{ x: centre.x, y: centre.y }]
    for (let r = 1; r <= rings; r++) {
        const distance = (blast * r) / (rings + 0.5)
        const count = perRing * r
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + r * 0.4
            points.push({ x: centre.x + Math.cos(angle) * distance, y: centre.y + Math.sin(angle) * distance })
        }
    }
    return points
}
