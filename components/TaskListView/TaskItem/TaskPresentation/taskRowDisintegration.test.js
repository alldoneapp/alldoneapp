import { Animated } from 'react-native'

import {
    COLLAPSE_START,
    CONTENT_FADE_START,
    DISINTEGRATION_DURATION_MS,
    DISSOLVE_BAND_RATIO,
    DISSOLVE_END,
    DISSOLVE_GRAIN_STEPS,
    DISSOLVE_MASK_IMAGE,
    DISSOLVE_MASK_SCALE,
    DISSOLVE_MASK_SIZE,
    DISSOLVE_TRAVEL,
    DUST_LIFT_ALPHA,
    DUST_LIFT_BAND_FRACTION,
    DUST_MOTES,
    DUST_MOTE_COUNT,
    EXIT_DELAY_MS,
    EXIT_HOLD_MS,
    EXIT_WRITE_BUFFER_MS,
    ROW_FADE_END,
    buildDissolveMaskStops,
    buildDustMotes,
    createDissolveStyle,
    createRowExitStyle,
    dissolveEdgeAt,
    dissolveFrontAt,
    dustMoteLiftOff,
    maxDustMoteEnd,
} from './taskRowDisintegration'

/**
 * AT-2495 — the geometry of the exit.
 *
 * The whole effect is one CSS mask sliding across the row, so almost everything that can go wrong
 * with it is arithmetic that produces a plausible-looking gradient which erases the wrong thing,
 * in the wrong direction, or never completely. None of that is observable from jest: jsdom has no
 * layout and `__mocks__/react-native.js` stubs `Animated.timing` to a no-op, so no suite here can
 * watch the animation run (that is what `browser-tests/at2495` is for).
 *
 * What CAN be checked here, and is, is the arithmetic — by re-deriving the CSS mask semantics from
 * the spec and sampling the resulting alpha across the row. `maskAlphaAt` below is that
 * re-derivation, and it is the reason a wrong `DISSOLVE_MASK_SCALE` fails loudly rather than
 * shipping a row that never quite disappears.
 */

/**
 * The alpha the mask applies at a point of the ROW, given a `mask-position`.
 *
 * Straight from the CSS Masking / Backgrounds spec:
 *   • the image is `DISSOLVE_MASK_SCALE` row-widths wide (`mask-size`);
 *   • `mask-position: p` offsets it by `(rowWidth - imageWidth) * p`;
 *   • with `mask-repeat: no-repeat`, anything outside the image is transparent.
 *
 * @param {number} rowX 0 = the row's left edge, 1 = its right edge.
 * @param {number} position 0 -> 1, the animated `mask-position` as a fraction.
 */
const maskAlphaAt = (rowX, position, stops = buildDissolveMaskStops()) => {
    const offset = (1 - DISSOLVE_MASK_SCALE) * position
    const u = (rowX - offset) / DISSOLVE_MASK_SCALE
    if (u < 0 || u > 1) return 0

    for (let index = 1; index < stops.length; index += 1) {
        const previous = stops[index - 1]
        const current = stops[index]
        if (u > current.offset) continue
        const span = current.offset - previous.offset
        if (span <= 0) return current.alpha
        const ratio = (u - previous.offset) / span
        return previous.alpha + (current.alpha - previous.alpha) * ratio
    }
    return stops[stops.length - 1].alpha
}

const acrossTheRow = (samples = 21) => Array.from({ length: samples }, (_unused, index) => index / (samples - 1))

describe('the dissolve mask (AT-2495)', () => {
    it('leaves the row completely untouched before it starts', () => {
        // Anything less than a fully opaque row at position 0 is a visible pop the instant the
        // mask is applied — and the mask is applied for the whole exit, not just for the dissolve.
        acrossTheRow().forEach(x => expect(maskAlphaAt(x, 0)).toBeCloseTo(1, 5))
    })

    it('erases the row completely by the time it finishes', () => {
        // The failure this catches is the quiet one: a mask that stops at 96% leaves a ghost of
        // the row sitting in the list until the collapse hides it.
        acrossTheRow().forEach(x => expect(maskAlphaAt(x, 1)).toBeCloseTo(0, 5))
    })

    it('erases the right-hand edge before the left-hand edge', () => {
        // THE requirement. Right to left, explicitly asked for over a random dissolve.
        const midRun = 0.5
        expect(maskAlphaAt(1, midRun)).toBeLessThan(maskAlphaAt(0, midRun))
    })

    it('never puts a pixel back once it has taken it', () => {
        // A gradient with a grainy band is easy to build so that some column briefly reappears as
        // the band slides over it, which reads as flicker rather than as dust.
        acrossTheRow(9).forEach(x => {
            let previous = Infinity
            for (let position = 0; position <= 1.0001; position += 0.02) {
                const alpha = maskAlphaAt(x, position)
                expect(alpha).toBeLessThanOrEqual(previous + 1e-9)
                previous = alpha
            }
        })
    })

    it('starts working on the row immediately rather than after a lead-in', () => {
        // A 1.2s effect cannot spend its first third with nothing happening. The band's leading
        // edge sits exactly on the row's right edge at t=0, so the first frame already bites.
        expect(dissolveFrontAt(0)).toBeCloseTo(1, 6)
        expect(maskAlphaAt(1, 0.08)).toBeLessThan(1)
    })

    it('carries the front all the way off the left-hand edge', () => {
        expect(dissolveFrontAt(DISSOLVE_END)).toBeLessThanOrEqual(0)
    })

    it('moves the front in one direction only', () => {
        let previous = Infinity
        for (let progress = 0; progress <= DISSOLVE_END; progress += DISSOLVE_END / 40) {
            const front = dissolveFrontAt(progress)
            expect(front).toBeLessThanOrEqual(previous)
            previous = front
        }
    })

    it('sizes the image from the band, so the row is the unit and not a pixel count', () => {
        // The same gesture has to read the same on a 320px phone row and a 1200px desktop row.
        expect(DISSOLVE_MASK_SCALE).toBe(2 + DISSOLVE_BAND_RATIO)
        expect(DISSOLVE_TRAVEL).toBe(DISSOLVE_MASK_SCALE - 1)
        expect(DISSOLVE_MASK_SIZE).toBe('245% 100%')
    })

    describe('the grain', () => {
        const stops = buildDissolveMaskStops()

        it('runs from solid to gone', () => {
            expect(stops[0]).toEqual({ offset: 0, alpha: 1 })
            expect(stops[stops.length - 1]).toEqual({ offset: 1, alpha: 0 })
        })

        it('is ordered', () => {
            stops.slice(1).forEach((stop, index) => expect(stop.offset).toBeGreaterThanOrEqual(stops[index].offset))
        })

        it('descends and never climbs, or the row would flicker', () => {
            // The counterpart of "never puts a pixel back" above, asserted on the gradient itself:
            // an alpha that rises anywhere along the band takes a pixel, gives it back and takes
            // it again as the band slides over it.
            stops.slice(1).forEach((stop, index) => expect(stop.alpha).toBeLessThanOrEqual(stops[index].alpha))
        })

        it('descends UNEVENLY, which is the whole difference from a fade', () => {
            // Grain is in the step sizes, not in the direction: a near-flat step is a patch of the
            // row that hangs on after its neighbours have gone, a steep one is a patch that goes
            // all at once. Even steps would be a cross-fade with extra vertices.
            const drops = stops.slice(1).map((stop, index) => stops[index].alpha - stop.alpha)
            const real = drops.filter(drop => drop > 0)
            expect(Math.max(...real)).toBeGreaterThan(Math.min(...real) * 3)
        })

        it('spaces its stops unevenly too', () => {
            const spans = stops.slice(1).map((stop, index) => stop.offset - stops[index].offset)
            const band = spans.slice(1, -1).filter(span => span > 0)
            expect(Math.max(...band)).toBeGreaterThan(Math.min(...band) * 2)
        })

        it('is stable across builds, so two rows never dissolve differently', () => {
            expect(buildDissolveMaskStops()).toEqual(stops)
            expect(DISSOLVE_MASK_IMAGE).toBe(
                `linear-gradient(to right, ${stops
                    .map(
                        ({ offset, alpha }) =>
                            `rgba(0, 0, 0, ${Number(alpha.toFixed(3))}) ${Number((offset * 100).toFixed(4))}%`
                    )
                    .join(', ')})`
            )
        })

        it('has enough steps to read as texture', () => {
            expect(DISSOLVE_GRAIN_STEPS).toBeGreaterThanOrEqual(6)
        })
    })
})

describe('the dust (AT-2495)', () => {
    it('sheds a mote exactly where the row has started coming apart', () => {
        // Lift-off is derived from the mask, not tuned by hand: a mote that appears before the row
        // under it has visibly started to thin is a dot floating over intact text.
        DUST_MOTES.forEach(mote => {
            expect(dissolveEdgeAt(mote.start, DUST_LIFT_BAND_FRACTION)).toBeCloseTo(mote.x, 6)
        })
    })

    it('waits for the row to actually thin rather than for the leading edge of the band', () => {
        // The grain's first steps are gentle by design, so the band's leading edge arrives well
        // before anything is visibly happening. Releasing dust there was the first version of this
        // and it put motes over untouched text.
        expect(DUST_LIFT_BAND_FRACTION).toBeGreaterThan(0)
        DUST_MOTES.forEach(mote => {
            // By the time a mote lifts off, the untouched edge has already travelled PAST it (i.e.
            // is to its left), so the column under the mote is well inside the band and thinning.
            expect(dissolveFrontAt(mote.start)).toBeLessThan(mote.x)
        })
    })

    it('derives that threshold from the gradient rather than hardcoding a delay', () => {
        // Retune the grain and the dust follows it. A hand-tuned stagger would silently slide out
        // of step with the mask the first time the band changed.
        const stops = buildDissolveMaskStops()
        const band = stops.filter(stop => stop.alpha < 1 && stop.alpha > 0)
        expect(band.some(stop => stop.alpha < DUST_LIFT_ALPHA)).toBe(true)
        expect(DUST_LIFT_BAND_FRACTION).toBeLessThan(1)
    })

    it('lifts off right to left, following the front', () => {
        const byPosition = [...DUST_MOTES].sort((a, b) => b.x - a.x)
        byPosition.slice(1).forEach((mote, index) => {
            expect(mote.start).toBeGreaterThanOrEqual(byPosition[index].start)
        })
        // The rightmost column is the first to go, and the leftmost the last.
        expect(dustMoteLiftOff(1)).toBeLessThan(dustMoteLiftOff(0))
        expect(dustMoteLiftOff(1)).toBeGreaterThanOrEqual(0)
        expect(dustMoteLiftOff(0)).toBeLessThan(DISSOLVE_END)
    })

    it('covers the whole row instead of clumping', () => {
        // One mote per column plus a bounded jitter. Free randomness at this count reliably leaves
        // a bald patch across a wide row.
        const gaps = [...DUST_MOTES]
            .sort((a, b) => a.x - b.x)
            .slice(1)
            .map((mote, index) => mote.x - DUST_MOTES.slice().sort((a, b) => a.x - b.x)[index].x)
        gaps.forEach(gap => expect(gap).toBeLessThan(2 / DUST_MOTE_COUNT))
    })

    it('always drifts upward and trails behind the front', () => {
        DUST_MOTES.forEach(mote => {
            // Falling reads as debris; rising reads as dispersal.
            expect(mote.rise).toBeLessThan(0)
            // The front travels left, so the dust it frees is left behind to its right.
            expect(mote.trail).toBeGreaterThan(0)
        })
    })

    it('stays inside the row rather than on its edges', () => {
        DUST_MOTES.forEach(mote => {
            expect(mote.y).toBeGreaterThan(0.1)
            expect(mote.y).toBeLessThan(0.9)
            expect(mote.x).toBeGreaterThanOrEqual(0)
            expect(mote.x).toBeLessThanOrEqual(1)
        })
    })

    it('is deterministic, so the same row dissolves the same way twice', () => {
        // Read during render, `Math.random()` would re-roll on every re-render and teleport a mote
        // onto a new trajectory mid-flight — and this row re-renders constantly.
        expect(buildDustMotes()).toEqual(DUST_MOTES)
        expect(buildDustMotes(4)).toHaveLength(4)
    })

    it('stays sparse enough to be dust rather than a particle system', () => {
        // Eighteen `Animated.View`s restyled by the JS driver on every frame, for 1.2s, on an
        // interaction that happens dozens of times an hour.
        expect(DUST_MOTE_COUNT).toBeLessThanOrEqual(24)
        expect(DUST_MOTES).toHaveLength(DUST_MOTE_COUNT)
    })
})

describe('the exit timeline (AT-2495)', () => {
    it('lasts the 1.2 seconds that were asked for', () => {
        expect(DISINTEGRATION_DURATION_MS).toBe(1200)
    })

    it('finishes every mote before the row starts closing the gap', () => {
        // The dust layer is clipped by the collapsing row, so a mote still in flight when the
        // height starts moving is cut off mid-air.
        expect(maxDustMoteEnd()).toBeLessThanOrEqual(COLLAPSE_START)
    })

    it('erases the row before it starts closing the gap', () => {
        // Shrinking a row that is still visible is the "deleted" reading this pass replaced.
        expect(DISSOLVE_END).toBeLessThan(COLLAPSE_START)
    })

    it('keeps the whole run inside the write hold', () => {
        expect(EXIT_HOLD_MS).toBe(EXIT_DELAY_MS + DISINTEGRATION_DURATION_MS + EXIT_WRITE_BUFFER_MS)
        expect(EXIT_WRITE_BUFFER_MS).toBeGreaterThan(0)
    })

    it('keeps the fallback fade behind the mask, where it cannot be seen', () => {
        // The fade only exists so the row still leaves if a browser ignores the mask. It must
        // start after the mask has already erased most of the row, or it would double-dim the
        // part that is still there.
        expect(CONTENT_FADE_START).toBeGreaterThan(DISSOLVE_END / 2)
        expect(ROW_FADE_END).toBeLessThanOrEqual(1)
    })
})

describe('the styles handed to the row (AT-2495)', () => {
    const progress = () => new Animated.Value(0)

    it('sets both the standard and the WebKit mask properties', () => {
        const style = createDissolveStyle(progress())

        expect(style.maskImage).toBe(DISSOLVE_MASK_IMAGE)
        expect(style.WebkitMaskImage).toBe(DISSOLVE_MASK_IMAGE)
        expect(style.maskSize).toBe(DISSOLVE_MASK_SIZE)
        expect(style.WebkitMaskSize).toBe(DISSOLVE_MASK_SIZE)
        // Without `no-repeat` the tile would wrap and re-reveal the row's left edge from the far
        // side of the image.
        expect(style.maskRepeat).toBe('no-repeat')
        expect(style.WebkitMaskRepeat).toBe('no-repeat')
    })

    it('gives each mask property its own interpolation', () => {
        // The same AnimatedInterpolation listed under two style keys is attached to the style
        // twice; two nodes are cheaper to reason about than that.
        const style = createDissolveStyle(progress())
        expect(style.maskPosition).not.toBe(style.WebkitMaskPosition)
        expect(style.maskPosition.__getValue()).toBe(style.WebkitMaskPosition.__getValue())
    })

    it('travels the mask across the row and then stops', () => {
        const value = progress()
        const style = createDissolveStyle(value)

        expect(style.maskPosition.__getValue()).toBe('0%')
        value.setValue(DISSOLVE_END)
        expect(style.maskPosition.__getValue()).toBe('100%')
        // Clamped: the mask holds at 100% while the row spends the rest of the run collapsing.
        value.setValue(1)
        expect(style.maskPosition.__getValue()).toBe('100%')
    })

    it('closes the gap only at the end, and leaves upward as it goes', () => {
        const value = progress()
        const style = createRowExitStyle(value, 48)

        expect(style.height.__getValue()).toBe(48)
        expect(style.opacity.__getValue()).toBe(1)
        expect(style.transform[0].translateY.__getValue()).toBe(0)
        expect(style.overflow).toBe('hidden')

        value.setValue(COLLAPSE_START)
        expect(style.height.__getValue()).toBe(48)

        value.setValue(1)
        expect(style.height.__getValue()).toBe(0)
        expect(style.opacity.__getValue()).toBe(0)
        expect(style.transform[0].translateY.__getValue()).toBeLessThan(0)
    })

    it('still removes the row if the mask is ignored', () => {
        // The one thing that must survive a browser without mask support: the row leaves. It just
        // leaves as a fade.
        const value = progress()
        const style = createRowExitStyle(value, 48)

        value.setValue(COLLAPSE_START)
        expect(style.opacity.__getValue()).toBeLessThan(1)
        value.setValue(ROW_FADE_END)
        expect(style.opacity.__getValue()).toBe(0)
    })
})
