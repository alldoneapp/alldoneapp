import { blastPoints, RAGE_DEFAULT_WEAPON, RAGE_WEAPONS, volleyAngles, weaponById } from './rageWeapons'

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

    it('fans a shotgun volley evenly around the aim', () => {
        const shotgun = weaponById('shotgun')
        const angles = volleyAngles(shotgun, 0)
        expect(angles).toHaveLength(shotgun.pellets)
        expect(angles[0]).toBeCloseTo(-shotgun.spread / 2)
        expect(angles[angles.length - 1]).toBeCloseTo(shotgun.spread / 2)
        expect(volleyAngles(weaponById('blaster'), 1.2)).toEqual([1.2])
    })

    it('covers a blast disc with sample points, none outside it', () => {
        const points = blastPoints({ x: 100, y: 100 }, 80)
        expect(points.length).toBeGreaterThan(20)
        points.forEach(p => expect(Math.hypot(p.x - 100, p.y - 100)).toBeLessThanOrEqual(80))
    })
})
