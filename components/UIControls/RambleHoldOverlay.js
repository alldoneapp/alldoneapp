import React, { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { createPortal } from 'react-dom'

import Icon from '../Icon'
import styles, { colors, hexColorToRGBa } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { useReducedMotion } from '../UIComponents/Ghosts/ghostAnimation'
import { getSafeAreaInsets } from '../../utils/safeAreaInsets'
import useWindowSize from '../../utils/useWindowSize'
import { PUSH_TO_TALK_CANCEL_RADIUS } from './pushToTalk'

/**
 * What the user sees while they HOLD the dictation mic (AT-2408).
 *
 * The problem it exists for is physical, not aesthetic: the mic is a 24px control at the right edge
 * of a text input, and on a phone the thumb holding it covers the control, the timer chip and a
 * good centimetre around them. So the two things the user most needs to know while holding —
 * "you are recording" and "sliding away throws this away" — were being drawn in the one place they
 * could not be seen. Everything here is therefore positioned RELATIVE TO THE FINGER and pushed out
 * beyond it.
 *
 * Two layers:
 *
 * 1. THE RING, drawn at exactly `PUSH_TO_TALK_CANCEL_RADIUS` around the press point. It is not
 *    decoration — it is the cancel boundary made visible, which is the whole reason the boundary
 *    moved from "the button's rect" to "a distance from the press" in `pushToTalk.js`. A rule the
 *    user can see is a rule they can use; the old one fired on a few pixels of thumb drift with
 *    nothing on screen to explain why their sentence vanished. It is dashed while the take is safe
 *    and solid once releasing would discard it, because a dashed boundary reads as "you may cross
 *    this" and a solid one as "you have".
 *
 * 2. THE CARD, a large status panel placed OUTSIDE the ring — above the finger where there is room,
 *    below it when the press lands near the top of the screen. This is the "much bigger" indicator:
 *    a pulsing record dot, the elapsed time at 20px instead of 12px, a live level meter, and the
 *    slide-to-cancel instruction. It flips to a solid red "release to cancel" panel the moment the
 *    finger crosses the ring.
 *
 * Rendered through a portal to `document.body` (the `BottomSheet` convention) because every host of
 * the mic — a chat composer, a task row, a comment popup — clips its own subtree, and this has to
 * escape all of them. `pointerEvents: 'none'` throughout: the gesture that drives this overlay is
 * listening on `window`, and an overlay that swallowed a single move event would freeze the very
 * boundary it is drawing.
 */

export const RAMBLE_RING_RADIUS = PUSH_TO_TALK_CANCEL_RADIUS

// The palette has no white token (`colors.funnyWhite` is a 20% wash); the card is dark, so its
// foreground is spelled out here rather than reaching for a near-white grey that would read dirty.
const CARD_FOREGROUND = '#FFFFFF'

// Measured against the ring, not the viewport: the card has to clear the finger, and the finger is
// at the ring's centre.
const CARD_GAP = 14
// Only used to decide above-vs-below before the card has been laid out. Over-estimating is the safe
// direction — it flips the card below a little earlier than strictly necessary, which is invisible,
// whereas under-estimating would tuck it under a notch.
const CARD_ESTIMATED_HEIGHT = 92
const VIEWPORT_MARGIN = 8

const METER_BARS = 5
const METER_BAR_HEIGHT = 22
const METER_BAR_MIN_SCALE = 0.16
// Speech peaks land around 0.05–0.4 of full scale, so the raw amplitude alone would leave the meter
// flat. sqrt lifts the quiet end (where the reassurance actually matters) without pinning the loud
// end to the ceiling.
const METER_GAIN = 1.7
// Each bar reads the level a little differently so the meter looks like a meter rather than five
// copies of one bar rising together.
const METER_BAR_WEIGHTS = [0.55, 0.85, 1, 0.8, 0.5]
const METER_ATTACK = 0.55
const METER_RELEASE = 0.18

const DOT_PULSE_MS = 620

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value)

/**
 * Where the status card goes, given where the finger is. Pure so the flip can be tested without a
 * layout engine — jsdom has none, and this is exactly the kind of arithmetic that is wrong by one
 * safe-area inset forever if nobody checks it.
 *
 * @returns {{top: number, placement: 'above'|'below'}}
 */
export function resolveHoldCardPosition({
    originY,
    windowHeight,
    insetTop = 0,
    insetBottom = 0,
    radius = RAMBLE_RING_RADIUS,
    cardHeight = CARD_ESTIMATED_HEIGHT,
}) {
    const above = originY - radius - CARD_GAP - cardHeight
    if (above >= insetTop + VIEWPORT_MARGIN) return { top: above, placement: 'above' }

    const below = originY + radius + CARD_GAP
    const lowestAllowed = windowHeight - insetBottom - cardHeight - VIEWPORT_MARGIN
    // A viewport too short for either side keeps the card on screen rather than half off it; the
    // ring still reads, and a clipped instruction is worse than one that overlaps the finger.
    return { top: Math.max(insetTop + VIEWPORT_MARGIN, Math.min(below, lowestAllowed)), placement: 'below' }
}

/**
 * The live level meter. Owns its own animation frame and writes straight into `Animated.Value`s,
 * so a mic level sampled ~60x a second never becomes 60 React renders a second — see the comment on
 * `getInputLevel` in `useRambleRecorder`, which is a getter for exactly this reason.
 */
function LevelMeter({ getInputLevel, active, tint }) {
    const reducedMotion = useReducedMotion()
    const bars = useMemo(() => Array.from({ length: METER_BARS }, () => new Animated.Value(METER_BAR_MIN_SCALE)), [])

    useEffect(() => {
        if (!active || reducedMotion || animationsAreDisabled() || typeof getInputLevel !== 'function') return undefined
        if (typeof requestAnimationFrame !== 'function') return undefined

        let frame = null
        const smoothed = bars.map(() => METER_BAR_MIN_SCALE)

        const tick = () => {
            const level = clamp01(Math.sqrt(Math.max(0, getInputLevel() || 0)) * METER_GAIN)
            bars.forEach((bar, index) => {
                const target = METER_BAR_MIN_SCALE + level * METER_BAR_WEIGHTS[index] * (1 - METER_BAR_MIN_SCALE)
                // Fast attack, slow release: the meter jumps onto a syllable and eases back down,
                // which is what makes it read as sound rather than as a random flicker.
                const factor = target > smoothed[index] ? METER_ATTACK : METER_RELEASE
                smoothed[index] += (target - smoothed[index]) * factor
                bar.setValue(smoothed[index])
            })
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => {
            if (frame != null) cancelAnimationFrame(frame)
            bars.forEach(bar => bar.setValue(METER_BAR_MIN_SCALE))
        }
    }, [active, reducedMotion, getInputLevel, bars])

    return (
        <View style={localStyles.meter}>
            {bars.map((bar, index) => (
                <Animated.View
                    key={index}
                    style={[localStyles.meterBar, { backgroundColor: tint, transform: [{ scaleY: bar }] }]}
                />
            ))}
        </View>
    )
}

function RecordDot({ tint }) {
    const reducedMotion = useReducedMotion()
    const pulse = useRef(new Animated.Value(1)).current

    useEffect(() => {
        if (reducedMotion || animationsAreDisabled()) {
            pulse.setValue(1)
            return undefined
        }
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 0.35,
                    duration: DOT_PULSE_MS,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: DOT_PULSE_MS,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [reducedMotion, pulse])

    return <Animated.View style={[localStyles.dot, { backgroundColor: tint, opacity: pulse }]} />
}

/**
 * @param {{
 *   visible: boolean,
 *   originX: number,
 *   originY: number,
 *   progress: Animated.Value,   // 0..1, written by the gesture; never a plain number (see below)
 *   armed: boolean,             // releasing now would discard the take
 *   elapsedLabel: string,
 *   getInputLevel?: () => number,
 * }} props
 */
export default function RambleHoldOverlay({ visible, originX, originY, progress, armed, elapsedLabel, getInputLevel }) {
    const [, windowHeight] = useWindowSize()

    // `progress` arrives as an Animated.Value rather than a number on purpose: it is written on
    // every pointermove, and a number prop would re-render this overlay AND its host input sixty
    // times a second. Only `armed` — which changes at most a handful of times per hold — is React
    // state.
    const rampDown = useMemo(() => progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), [progress])

    if (!visible || typeof document === 'undefined' || !Number.isFinite(originX) || !Number.isFinite(originY)) {
        return null
    }

    const insets = getSafeAreaInsets()
    const { top: cardTop } = resolveHoldCardPosition({
        originY,
        windowHeight,
        insetTop: insets.top,
        insetBottom: insets.bottom,
    })

    const ringBox = {
        left: originX - RAMBLE_RING_RADIUS,
        top: originY - RAMBLE_RING_RADIUS,
        width: RAMBLE_RING_RADIUS * 2,
        height: RAMBLE_RING_RADIUS * 2,
        borderRadius: RAMBLE_RING_RADIUS,
    }

    return createPortal(
        <View testID={'ramble-hold-overlay'} style={localStyles.root}>
            <Animated.View style={[localStyles.ringFillSafe, ringBox, { opacity: rampDown }]} />
            <Animated.View style={[localStyles.ringFillArmed, ringBox, { opacity: progress }]} />
            <Animated.View
                testID={'ramble-hold-ring-safe'}
                style={[localStyles.ringSafe, ringBox, { opacity: rampDown }]}
            />
            <Animated.View
                testID={'ramble-hold-ring-armed'}
                style={[localStyles.ringArmed, ringBox, { opacity: progress }]}
            />

            <View testID={'ramble-hold-card-row'} style={[localStyles.cardRow, { top: cardTop }]}>
                <View testID={'ramble-hold-card'} style={[localStyles.card, armed && localStyles.cardArmed]}>
                    <View style={localStyles.cardTop}>
                        {armed ? (
                            <Icon name={'trash-2'} size={20} color={CARD_FOREGROUND} />
                        ) : (
                            <RecordDot tint={colors.UtilityRed200} />
                        )}
                        <Text style={[styles.title6, localStyles.elapsed]}>{elapsedLabel}</Text>
                        {!armed && (
                            <LevelMeter
                                getInputLevel={getInputLevel}
                                active={visible && !armed}
                                tint={hexColorToRGBa(CARD_FOREGROUND, 0.85)}
                            />
                        )}
                    </View>
                    {/* The live region sits on the instruction, not on the card: the card also
                        holds the elapsed time, and a polite region around a value that changes
                        every second would make a screen reader read the clock aloud for the whole
                        recording. What is worth announcing is the state flip. */}
                    <Text accessibilityLiveRegion={'polite'} style={[styles.subtitle2, localStyles.hint]}>
                        {translate(armed ? 'Release to cancel' : 'Slide away to cancel')}
                    </Text>
                </View>
            </View>
        </View>,
        document.body
    )
}

const localStyles = StyleSheet.create({
    root: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // Above every modal, popover and sheet: the mic is hosted inside all of them. Safe at this
        // height only because nothing here takes the pointer — the gesture driving this overlay is
        // listening on `window`, and swallowing one move event would freeze the boundary being
        // drawn. Set in the style rather than through the deprecated `pointerEvents` prop.
        pointerEvents: 'none',
        zIndex: 1000000,
    },
    ringFillSafe: {
        position: 'absolute',
        backgroundColor: hexColorToRGBa(colors.UtilityRed200, 0.06),
    },
    ringFillArmed: {
        position: 'absolute',
        backgroundColor: hexColorToRGBa(colors.UtilityRed300, 0.18),
    },
    ringSafe: {
        position: 'absolute',
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: hexColorToRGBa(colors.UtilityRed200, 0.45),
    },
    ringArmed: {
        position: 'absolute',
        borderWidth: 3,
        borderStyle: 'solid',
        borderColor: colors.UtilityRed300,
    },
    cardRow: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    card: {
        minWidth: 208,
        maxWidth: 340,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 16,
        alignItems: 'center',
        // The dark card is the app's sheet colour, so the panel reads as app chrome rather than as
        // an error, and it stays legible over both a white list and a coloured detailed view.
        backgroundColor: colors.Secondary400,
        // `boxShadow` rather than the RN `shadow*` props: this app is web-only in practice, the
        // rest of the codebase spells it this way, and react-native-web deprecated the others.
        boxShadow: '0px 6px 18px rgba(4,20,47,0.28)',
    },
    cardArmed: {
        backgroundColor: colors.UtilityRed300,
    },
    cardTop: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    elapsed: {
        color: CARD_FOREGROUND,
        marginLeft: 10,
        // Tabular-ish spacing: the label reflows every second and a jumping card is distracting.
        minWidth: 46,
    },
    meter: {
        flexDirection: 'row',
        alignItems: 'center',
        height: METER_BAR_HEIGHT,
        marginLeft: 8,
    },
    meterBar: {
        width: 3,
        height: METER_BAR_HEIGHT,
        borderRadius: 2,
        marginHorizontal: 2,
    },
    hint: {
        color: hexColorToRGBa(CARD_FOREGROUND, 0.82),
        marginTop: 4,
        textAlign: 'center',
    },
})
