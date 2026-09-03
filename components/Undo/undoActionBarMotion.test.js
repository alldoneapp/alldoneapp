import {
    UNDO_ANIMATION_IDS,
    UNDO_ANIMATION_VARIANTS,
    UNDO_DISPLAY_TIME_MS,
    UNDO_ENTER_MS,
    UNDO_EXIT_MS,
    UNDO_EXIT_SETTLE_BUFFER_MS,
    UNDO_MOTION_REST,
    UNDO_NUDGE_MS,
    UNDO_TRANSFORM_ORDER,
    buildUndoMotionStyle,
    pickUndoAnimationVariantId,
} from './undoActionBarMotion'

/**
 * AT-2503 — the geometry of the four Undo-banner animations, and the rule that picks between them.
 *
 * This file can be exhaustive because the variants are pure DATA. `__mocks__/react-native.js`
 * replaces `Animated.timing` with a no-op, so no jest test anywhere in this repo can watch one of
 * these actually run — but every property that decides whether the motion is CORRECT (does it end
 * where it started? does it overshoot? is the overshoot small? does it touch layout?) is a property
 * of the keyframes, and those are checkable to the number.
 *
 * The invariant that matters most is the boring one: an entry must finish at rest. A variant that
 * ends at translateY: -2 leaves the banner permanently two pixels high, forever, with nothing on
 * screen to suggest why.
 */

const ANIMATABLE_CHANNELS = ['opacity', ...UNDO_TRANSFORM_ORDER]

const degrees = value => Number(String(value).replace('deg', ''))

const eachVariant = callback => {
    UNDO_ANIMATION_IDS.forEach(id => callback(id, UNDO_ANIMATION_VARIANTS[id]))
}

describe('the Undo banner animation variants (AT-2503)', () => {
    it('offers four of them, which is what "several, randomly selected" was asked for', () => {
        expect(UNDO_ANIMATION_IDS).toEqual(['drop', 'pop', 'glide', 'tilt'])
    })

    it('animates only opacity and transform, so a banner can never relayout the app behind it', () => {
        eachVariant((id, variant) => {
            Object.keys(variant.enter).forEach(channel => {
                expect(`${id}.enter.${channel}`).toBe(
                    `${id}.enter.${ANIMATABLE_CHANNELS.includes(channel) ? channel : 'LAYOUT-AFFECTING'}`
                )
            })
            Object.keys(variant.exit).forEach(channel => {
                expect(`${id}.exit.${channel}`).toBe(
                    `${id}.exit.${ANIMATABLE_CHANNELS.includes(channel) ? channel : 'LAYOUT-AFFECTING'}`
                )
            })
        })
    })

    it('drives every direction over a full, strictly increasing 0 → 1 range', () => {
        eachVariant((id, variant) => {
            ;['enter', 'exit'].forEach(direction => {
                Object.entries(variant[direction]).forEach(([channel, keyframes]) => {
                    const where = `${id}.${direction}.${channel}`
                    const { inputRange, outputRange } = keyframes

                    expect(`${where}: ${inputRange.length} in / ${outputRange.length} out`).toBe(
                        `${where}: ${inputRange.length} in / ${inputRange.length} out`
                    )
                    expect(`${where} starts at ${inputRange[0]}`).toBe(`${where} starts at 0`)
                    expect(`${where} ends at ${inputRange[inputRange.length - 1]}`).toBe(`${where} ends at 1`)

                    const monotonic = inputRange.every((value, index) => index === 0 || value > inputRange[index - 1])
                    expect(`${where} monotonic: ${monotonic}`).toBe(`${where} monotonic: true`)
                })
            })
        })
    })

    /**
     * The load-bearing one. An entry that does not land exactly on the resting values leaves the
     * banner displaced or transparent for the rest of its life, and an exit that does not START
     * there jumps on its first frame.
     */
    it('lands every entry at rest, and starts every exit from rest', () => {
        eachVariant((id, variant) => {
            Object.entries(variant.enter).forEach(([channel, { outputRange }]) => {
                expect(`${id}.enter.${channel} → ${outputRange[outputRange.length - 1]}`).toBe(
                    `${id}.enter.${channel} → ${UNDO_MOTION_REST[channel]}`
                )
            })
            Object.entries(variant.exit).forEach(([channel, { outputRange }]) => {
                expect(`${id}.exit.${channel} from ${outputRange[0]}`).toBe(
                    `${id}.exit.${channel} from ${UNDO_MOTION_REST[channel]}`
                )
            })
        })
    })

    it('fades every entry up from nothing and every exit down to nothing', () => {
        eachVariant((id, variant) => {
            expect(`${id} enters at opacity ${variant.enter.opacity.outputRange[0]}`).toBe(`${id} enters at opacity 0`)
            const exitOpacity = variant.exit.opacity.outputRange
            expect(`${id} exits at opacity ${exitOpacity[exitOpacity.length - 1]}`).toBe(`${id} exits at opacity 0`)
        })
    })

    /** "Snappy with a small overshoot" — the overshoot half, pinned per variant. */
    it('overshoots its resting place on the way in, on at least one channel', () => {
        eachVariant((id, variant) => {
            const overshoots = Object.entries(variant.enter)
                .filter(([channel]) => channel !== 'opacity')
                .some(([channel, { outputRange }]) => {
                    const rest = channel === 'rotate' ? degrees(UNDO_MOTION_REST[channel]) : UNDO_MOTION_REST[channel]
                    const from = channel === 'rotate' ? degrees(outputRange[0]) : outputRange[0]
                    // Past the resting value, on the far side from where it started.
                    return outputRange.slice(1, -1).some(value => {
                        const point = channel === 'rotate' ? degrees(value) : value
                        return from < rest ? point > rest : point < rest
                    })
                })
            expect(`${id} overshoots: ${overshoots}`).toBe(`${id} overshoots: true`)
        })
    })

    /**
     * ...and the SMALL half. This banner sits over the top of whatever the user was doing, so the
     * bound is expressed against the thing being moved: nothing travels further than the card's own
     * 48px minimum height, and the tilt is capped at the smallest angle that is still legible.
     */
    it('keeps every displacement small enough not to read as disruptive', () => {
        eachVariant((id, variant) => {
            ;['enter', 'exit'].forEach(direction => {
                Object.entries(variant[direction]).forEach(([channel, { outputRange }]) => {
                    const where = `${id}.${direction}.${channel}`
                    outputRange.forEach(value => {
                        if (channel === 'translateX' || channel === 'translateY') {
                            expect(`${where} |${value}| <= 48: ${Math.abs(value) <= 48}`).toBe(
                                `${where} |${value}| <= 48: true`
                            )
                        }
                        if (channel === 'scale') {
                            expect(`${where} ${value} in [0.8, 1.06]: ${value >= 0.8 && value <= 1.06}`).toBe(
                                `${where} ${value} in [0.8, 1.06]: true`
                            )
                        }
                        if (channel === 'rotate') {
                            const angle = Math.abs(degrees(value))
                            expect(`${where} ${value} <= 4deg: ${angle <= 4}`).toBe(`${where} ${value} <= 4deg: true`)
                        }
                    })
                })
            })
        })
    })

    it('mirrors the entry on the way out — same channels, so an arrival and its departure match', () => {
        eachVariant((id, variant) => {
            const moved = keyframes => Object.keys(keyframes).filter(channel => channel !== 'opacity')
            expect(`${id}: ${moved(variant.exit).sort()}`).toBe(`${id}: ${moved(variant.enter).sort()}`)
        })
    })
})

describe('Undo banner animation timing (AT-2503)', () => {
    it('is quick in both directions, and quicker leaving than arriving', () => {
        expect(UNDO_ENTER_MS).toBeLessThanOrEqual(300)
        expect(UNDO_EXIT_MS).toBeLessThan(UNDO_ENTER_MS)
        expect(UNDO_NUDGE_MS).toBeLessThanOrEqual(300)
        expect(UNDO_EXIT_MS).toBeGreaterThan(0)
    })

    it('holds the banner mounted past the end of its exit so the last frame cannot be clipped', () => {
        expect(UNDO_EXIT_SETTLE_BUFFER_MS).toBeGreaterThan(0)
    })

    it('leaves the ten-second display time exactly as it was before the animation work', () => {
        // The countdown line visualises this number; AT-2503 changed how the banner arrives and
        // leaves, deliberately not how long it stays.
        expect(UNDO_DISPLAY_TIME_MS).toBe(10000)
        expect(UNDO_DISPLAY_TIME_MS).toBeGreaterThan(UNDO_ENTER_MS + UNDO_EXIT_MS)
    })
})

describe('picking the next Undo banner animation (AT-2503)', () => {
    it('never repeats the one that just played', () => {
        UNDO_ANIMATION_IDS.forEach(previous => {
            // Sweep the whole unit interval: no draw may ever return the previous id.
            for (let draw = 0; draw < 100; draw++) {
                const picked = pickUndoAnimationVariantId(previous, () => draw / 100)
                expect(`after ${previous} → ${picked}`).not.toBe(`after ${previous} → ${previous}`)
                expect(UNDO_ANIMATION_IDS).toContain(picked)
            }
        })
    })

    it('can reach every other variant', () => {
        const reached = new Set()
        for (let draw = 0; draw < 100; draw++) reached.add(pickUndoAnimationVariantId('drop', () => draw / 100))
        expect([...reached].sort()).toEqual(['glide', 'pop', 'tilt'])
    })

    it('has the full set available on the first appearance, when nothing has played yet', () => {
        const reached = new Set()
        for (let draw = 0; draw < 100; draw++) reached.add(pickUndoAnimationVariantId(null, () => draw / 100))
        expect([...reached].sort()).toEqual([...UNDO_ANIMATION_IDS].sort())
    })

    /**
     * `Math.random()` is `[0, 1)`, so `Math.floor(random() * n)` is in range — until something
     * hands it a 1. An out-of-range index returns `undefined`, which is not a wrong animation but a
     * crash in the render that consumes it, so the index is clamped rather than trusted.
     */
    it('cannot be pushed off the end of the pool by a bad random source', () => {
        expect(UNDO_ANIMATION_IDS).toContain(pickUndoAnimationVariantId('drop', () => 1))
        expect(UNDO_ANIMATION_IDS).toContain(pickUndoAnimationVariantId('drop', () => 1.5))
        expect(UNDO_ANIMATION_IDS).toContain(pickUndoAnimationVariantId('drop', () => -0.2))
        expect(UNDO_ANIMATION_IDS).toContain(pickUndoAnimationVariantId('drop', () => NaN))
    })

    it('still answers when the previous id is not one of ours', () => {
        expect(UNDO_ANIMATION_IDS).toContain(pickUndoAnimationVariantId('a-variant-that-was-deleted', () => 0.5))
    })
})

describe('building the Undo banner motion style (AT-2503)', () => {
    // Stands in for an Animated.Value: `interpolate` hands back exactly what it was given, so the
    // assertions below are about which keyframes reach which style key.
    const progress = { interpolate: config => config }

    it('serialises transforms in a fixed order so rotation happens about the card centre', () => {
        const style = buildUndoMotionStyle(progress, UNDO_ANIMATION_VARIANTS.tilt.enter)

        expect(style.transform.map(entry => Object.keys(entry)[0])).toEqual(['translateY', 'scale', 'rotate'])
        expect(style.opacity).toBe(UNDO_ANIMATION_VARIANTS.tilt.enter.opacity)
    })

    it('omits transform entirely for a variant that only moves opacity', () => {
        const style = buildUndoMotionStyle(progress, { opacity: { inputRange: [0, 1], outputRange: [0, 1] } })

        expect(style.transform).toBeUndefined()
        expect(style.opacity).toBeDefined()
    })

    it('composes the content nudge AFTER the variant, so a beat during a pop entry stacks', () => {
        const beat = { scale: 'nudge-scale' }
        const style = buildUndoMotionStyle(progress, UNDO_ANIMATION_VARIANTS.pop.enter, [beat])

        expect(style.transform).toHaveLength(2)
        expect(style.transform[1]).toBe(beat)
        expect(Object.keys(style.transform[0])).toEqual(['scale'])
    })

    it('survives being handed no keyframes at all', () => {
        expect(buildUndoMotionStyle(progress, null)).toEqual({})
    })
})
