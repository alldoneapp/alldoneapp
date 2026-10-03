import { mainGun, nearestAhead, specialAngles, steerTowards, UP } from './raidArmory'
import { weaponById } from './rageWeapons'

describe('raid armory', () => {
    it('adds barrels and fires faster with each cannon level, and clamps silly levels', () => {
        expect(mainGun(1).barrels).toHaveLength(2)
        expect(mainGun(2).barrels.length).toBeGreaterThan(mainGun(1).barrels.length)
        expect(mainGun(3).interval).toBeLessThan(mainGun(1).interval)
        expect(mainGun(0)).toBe(mainGun(1))
        expect(mainGun(9)).toBe(mainGun(3))
    })

    it('fans a shotgun volley symmetrically around straight up', () => {
        const angles = specialAngles(weaponById('shotgun'))
        expect(angles).toHaveLength(6)
        expect(angles[0] + angles[5]).toBeCloseTo(2 * UP)
        expect(specialAngles(weaponById('rocket'))).toEqual([UP])
    })

    it('turns a rocket towards its target, but no faster than its turn rate', () => {
        const from = { x: 0, y: 0 }
        const turned = steerTowards(UP, from, { x: 100, y: 0 }, 2, 0.1)
        expect(turned).toBeCloseTo(UP + 0.2)
        expect(steerTowards(UP, from, null, 2, 0.1)).toBe(UP)
        // Takes the short way round across ±π.
        expect(steerTowards(Math.PI - 0.05, from, { x: -10, y: -1 }, 10, 1)).toBeGreaterThan(Math.PI - 0.05)
    })

    it('homes on the nearest target ahead, never on one behind', () => {
        const from = { x: 500, y: 600 }
        const ahead = { x: 520, y: 400 }
        expect(nearestAhead(from, [{ x: 500, y: 900 }, ahead, { x: 100, y: 100 }])).toBe(ahead)
        expect(nearestAhead(from, [{ x: 500, y: 900 }])).toBeNull()
    })
})
