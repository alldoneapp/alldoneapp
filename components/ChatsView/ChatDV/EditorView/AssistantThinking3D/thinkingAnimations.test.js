/**
 * Every scene is built from the REAL three.js and stepped through time. Nothing else in the suite
 * executes these modules (they only load behind a dynamic import), so this is what catches a scene
 * that throws, produces NaN, or drifts out of the frame the stage camera sees.
 */
import { Vector3 } from 'three'

import { buildThinkingAnimation, THINKING_ANIMATION_BUILDER_NAMES, THINKING_PALETTES } from './thinkingAnimations'
import { THINKING_ANIMATIONS } from './thinkingAnimationChoice'

// The stage camera (fov 32 at distance 5.2) sees 1.49 units either side of the origin at z = 0.
const FRAME_RADIUS = 1.49
const TOWER_CYCLE = 6 * 0.42 + 0.8 + 0.35

// The furthest any visible mesh reaches from the origin, from each geometry's bounding sphere.
const reach = root => {
    root.updateMatrixWorld(true)
    let furthest = 0
    const centre = new Vector3()
    const scale = new Vector3()
    root.traverse(object => {
        if (!object.isMesh || !object.visible) return
        if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere()
        const sphere = object.geometry.boundingSphere
        centre.copy(sphere.center).applyMatrix4(object.matrixWorld)
        scale.setFromMatrixScale(object.matrixWorld)
        furthest = Math.max(furthest, centre.length() + sphere.radius * Math.max(scale.x, scale.y, scale.z))
    })
    return furthest
}

describe('thinking animations', () => {
    test('there is a builder for every scene the card can pick, and ten of them', () => {
        expect(THINKING_ANIMATIONS).toHaveLength(10)
        expect([...THINKING_ANIMATION_BUILDER_NAMES].sort()).toEqual([...THINKING_ANIMATIONS].sort())
    })

    test.each(THINKING_ANIMATIONS.flatMap(name => Object.keys(THINKING_PALETTES).map(look => [name, look])))(
        '%s (%s) animates without errors and stays in frame',
        (name, appearance) => {
            const { root, update } = buildThinkingAnimation(name, appearance)
            for (let t = 0; t <= 24; t += 0.07) {
                update(t)
                const furthest = reach(root)
                expect(Number.isFinite(furthest)).toBe(true)
                // The tower's blocks deliberately drop in from above the frame; check it once built.
                const towerBuilt = t % TOWER_CYCLE > 2.6 && t % TOWER_CYCLE < 3.3
                if (name !== 'tower' || towerBuilt) expect(furthest).toBeLessThan(FRAME_RADIUS)
            }
        }
    )

    test.each(THINKING_ANIMATIONS)('%s stays in frame while being poked', name => {
        const { root, update } = buildThinkingAnimation(name)
        // Build the tower first, then poke every scene repeatedly and step through each reaction.
        for (let poke = 0; poke < 6; poke++) {
            for (let since = 0; since < 1.4; since += 0.03) {
                const t = 2.7 + poke * 1.4 + since
                update(t, { sincePoke: since, energy: 1, attention: 1, pokes: poke + 1 })
                const towerBuilt = t % TOWER_CYCLE > 2.6 && t % TOWER_CYCLE < 3.3
                if (name !== 'tower' || towerBuilt) expect(reach(root)).toBeLessThan(FRAME_RADIUS)
            }
        }
    })

    test('the scenes are functions of time, so a card coming back into view is not in a random state', () => {
        const first = buildThinkingAnimation('network')
        const second = buildThinkingAnimation('network')
        first.update(0.3)
        first.update(7.9)
        second.update(7.9)
        first.root.updateMatrixWorld(true)
        second.root.updateMatrixWorld(true)
        const positions = root => {
            const list = []
            root.traverse(object => object.isMesh && list.push(new Vector3().setFromMatrixPosition(object.matrixWorld)))
            return list
        }
        positions(first.root).forEach((position, index) =>
            expect(position.distanceTo(positions(second.root)[index])).toBeLessThan(1e-6)
        )
    })

    test('the cube keeps all 27 cubies on the grid through many layer turns', () => {
        const { root, update } = buildThinkingAnimation('cube')
        for (let t = 0; t < 40; t += 0.1) update(t)
        update(40 * 0.95 + 0.7) // between turns
        root.updateMatrixWorld(true)
        const cubies = []
        root.traverse(object => object.isMesh && cubies.push(object))
        expect(cubies).toHaveLength(27)
        const keys = new Set(
            cubies.map(cubie => {
                const local = root.worldToLocal(new Vector3().setFromMatrixPosition(cubie.matrixWorld))
                return local
                    .toArray()
                    .map(value => Math.round(value / 0.36))
                    .join(',')
            })
        )
        expect(keys.size).toBe(27)
    })

    test('an unknown scene name falls back to a real scene rather than throwing', () => {
        expect(() => buildThinkingAnimation('nope').update(1)).not.toThrow()
    })
})
