import { RAGE_DEFAULT_WEAPON, RAGE_WEAPONS, weaponById } from './rageWeapons'

// The server's price list is the one that charges; this copy is for display only.
const serverCatalog = require('../../functions/RageMode/rageWeaponsCatalog')

describe('rage mode weapons', () => {
    it('offers exactly the weapons the server sells, at the server price', () => {
        const client = Object.fromEntries(RAGE_WEAPONS.map(weapon => [weapon.id, weapon.price]))
        expect(client).toEqual(serverCatalog.RAGE_WEAPON_PRICES)
        expect(RAGE_DEFAULT_WEAPON).toBe(serverCatalog.RAGE_DEFAULT_WEAPON)
    })

    it('gives the free weapon away and sorts the shop by price', () => {
        expect(weaponById(RAGE_DEFAULT_WEAPON).price).toBe(0)
        const prices = RAGE_WEAPONS.map(weapon => weapon.price)
        expect(prices).toEqual([...prices].sort((a, b) => a - b))
    })

    it('falls back to the blaster for an unknown id', () => {
        expect(weaponById('bazooka').id).toBe('blaster')
    })
})
