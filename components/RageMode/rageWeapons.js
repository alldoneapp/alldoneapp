/**
 * Rage mode's special weapons: how each one fires in the raid, and what it costs in the shop. They
 * are bought with Gold and owned for good; in the raid the chosen one fires automatically ON TOP of
 * the main gun (`raidArmory.js`). The blaster is free and means "main gun only".
 *
 * The price here is for DISPLAY. The server's copy (`functions/RageMode/rageWeaponsCatalog.js`) is
 * the one that charges, and `rageWeapons.test.js` fails the build if the two disagree. Functions
 * code cannot enter the web bundle, hence the two copies.
 *
 * `kind` picks the firing code in `raidArena.js`:
 *   bolt       a fan of `pellets` pellets over `spread` radians, lasting `range` px
 *   rocket     a homing rocket that explodes over `blast` px
 *   flame      a short cone of flame particles, `range` px long, burning each target once
 *   laser      a beam straight up from Anna, ticking `damage` every `interval` while equipped
 *   blackhole  flies out for `travel` s, swallows enemy fire for `pull` s, then implodes over `blast` px
 *   snap       every `interval` s: `damage` to everything on screen
 * `damage` is per hit, against enemy health (a fighter has 5, the boss 12 per open task).
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
