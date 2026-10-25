/**
 * The rage-mode weapon shop's price list — the SERVER's copy, and the only one that decides what a
 * purchase costs. The client carries its own copy for display (`components/RageMode/rageWeapons.js`,
 * since Functions code cannot enter the web bundle); `rageWeapons.test.js` fails the build if the
 * two ever disagree about which weapons exist or what they cost.
 *
 * Prices are in Gold, set against what a user can earn: 1–5 Gold per completed task, capped at 100
 * a day, so the shotgun is one very productive day and the finger snap is a real goal.
 */
const RAGE_DEFAULT_WEAPON = 'blaster'

const RAGE_WEAPON_PRICES = Object.freeze({
    blaster: 0,
    shotgun: 100,
    rocket: 250,
    flamethrower: 400,
    laser: 600,
    blackhole: 1000,
    snap: 2000,
})

module.exports = { RAGE_DEFAULT_WEAPON, RAGE_WEAPON_PRICES }
