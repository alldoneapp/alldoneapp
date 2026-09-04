import { useEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { colors } from '../../../styles/global'
import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2511 — the motion the Last comment card plays when a comment it has never shown lands in it.
 *
 * The slot is the payoff of the whole assistant line: you type a line, the composer empties
 * (AT-2504), the pending card says "working on it", and then the answer appears — by silently
 * swapping its text, indistinguishable from a re-render. This gives that moment a shape.
 *
 * The beats, in the order the eye travels:
 *
 *   1. RISE (t=0, 280ms) — the card's CONTENT fades in and comes up 8px into place. The card's
 *      background, border radius and height are untouched, which is the whole trick: the slot never
 *      becomes a hole, so nothing below it can appear to move even for a frame. Fading the card
 *      itself was tried first and reads as the comment being deleted and replaced.
 *   2. GLOW (t=40, 520ms) — one accent band travels left to right across the card, clipped to its
 *      own rounded rect. Deliberately ACCENT-coloured (`Primary100` at low alpha) and one-shot,
 *      never the white infinite band of `ghostShimmerStyles`: in this app a travelling white
 *      shimmer means "loading", and the one thing this card must not say at the moment the answer
 *      lands is that it is still waiting.
 *   3. POP (t=120, 260ms) — the unread badge scales up from 0.4 through a small overshoot. It is
 *      the element that carries the "new" information, so it is the one thing that is allowed to
 *      overshoot.
 *
 * ~600ms in total, none of which delays anything: unlike `taskCompletionMotion` there is no write
 * being held here. The comment is already stored and already interactive — tapping the card during
 * the animation opens the thread exactly as before.
 *
 * ## Geometry
 *
 * Everything is `opacity` and `transform`, so the card's fixed `LAST_COMMENT_PREVIEW_HEIGHT`
 * contract is preserved to the pixel and the assistant line cannot reflow. The 8px rise is a
 * transform on an inner wrapper, NOT a margin.
 *
 * ## Reduced motion, and renderers that cannot measure
 *
 * `prefers-reduced-motion` renders the finished frame directly — content at full opacity, no band,
 * no pop. Nothing is lost: "this is new" is carried by the unread badge, which is a static element.
 * The band additionally needs a measured card width (`onLayout`), so under jest and any renderer
 * that reports no layout it simply never renders, rather than sweeping a guessed distance.
 */

export const RISE_DURATION_MS = 280
export const RISE_DISTANCE = 8
export const GLOW_DELAY_MS = 40
export const GLOW_DURATION_MS = 520
export const BADGE_DELAY_MS = 120
export const BADGE_DURATION_MS = 260
export const ARRIVAL_TOTAL_MS = GLOW_DELAY_MS + GLOW_DURATION_MS

// Wide enough to read as a soft band rather than a hairline, narrow enough that it is visibly
// travelling across the card rather than washing over the whole of it at once.
const BAND_WIDTH_RATIO = 0.45
const MIN_BAND_WIDTH = 72

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * NOT `hexColorToRGBa(color, 0)`. That helper's alpha branch is `if (alpha)`, and `0` is falsy, so
 * it returns a fully OPAQUE `rgb(...)` for a transparent stop — a gradient built with it is a hard
 * accent RECTANGLE with a slightly different middle, which is precisely the shape this band must
 * not have. `browser-tests/at2511` is what caught it; jsdom reports no computed gradient, so no
 * jest suite could. (The same call exists in `ghostShimmerStyles`, where white-on-grey hides it.)
 */
const accentAlpha = alpha => {
    const hex = colors.Primary100.replace('#', '')
    const channel = index => parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    return `rgba(${channel(0)},${channel(1)},${channel(2)},${alpha})`
}

export const ARRIVAL_BAND_PEAK_ALPHA = 0.16

/**
 * `backgroundImage` survives react-native-web's style processing verbatim (same mechanism
 * `ghostShimmerStyles` relies on). There is deliberately no `backgroundColor` fallback: on a
 * renderer that drops the gradient, an accent RECTANGLE would slide across the card, which is far
 * worse than no band at all.
 */
export const arrivalBandBackground = `linear-gradient(90deg, ${accentAlpha(0)} 0%, ${accentAlpha(ARRIVAL_BAND_PEAK_ALPHA)} 50%, ${accentAlpha(0)} 100%)`

export const resolveBandWidth = cardWidth => Math.max(MIN_BAND_WIDTH, Math.round(cardWidth * BAND_WIDTH_RATIO))

/**
 * @param arrivalId a fresh number per arrival (see `lastCommentArrival.js`), or null for "nothing
 *        has arrived". A number rather than a boolean so two arrivals in a row restart the motion.
 */
export const useLastCommentArrivalMotion = arrivalId => {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()

    // Rest state is the FINISHED frame (1), not the starting one: a card that has not received an
    // arrival — every first paint, every reload — must render complete and unanimated, and a value
    // seeded at 0 would leave it invisible on any renderer where the animation never runs.
    const rise = useRef(new Animated.Value(1)).current
    const glow = useRef(new Animated.Value(1)).current
    const badge = useRef(new Animated.Value(1)).current
    const [cardWidth, setCardWidth] = useState(0)
    const [glowRunId, setGlowRunId] = useState(null)

    useEffect(() => {
        if (!arrivalId) return undefined

        if (!animated) {
            rise.setValue(1)
            glow.setValue(1)
            badge.setValue(1)
            return undefined
        }

        rise.setValue(0)
        glow.setValue(0)
        badge.setValue(0)
        setGlowRunId(arrivalId)

        const animation = Animated.parallel([
            Animated.timing(rise, {
                toValue: 1,
                duration: RISE_DURATION_MS,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            }),
            Animated.sequence([
                Animated.delay(GLOW_DELAY_MS),
                Animated.timing(glow, {
                    toValue: 1,
                    duration: GLOW_DURATION_MS,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: false,
                }),
            ]),
            Animated.sequence([
                Animated.delay(BADGE_DELAY_MS),
                Animated.timing(badge, {
                    toValue: 1,
                    duration: BADGE_DURATION_MS,
                    easing: Easing.out(Easing.back(1.7)),
                    useNativeDriver: false,
                }),
            ]),
        ])

        animation.start()
        return () => animation.stop()
    }, [arrivalId, animated, rise, glow, badge])

    // The band is removed once it has left the card. Keeping a finished absolute overlay mounted
    // would leave a transparent layer over the card forever, and this one is `pointerEvents: none`
    // only because it is never meant to be reachable at all.
    useEffect(() => {
        if (!glowRunId || !animated) return undefined
        const timer = setTimeout(() => setGlowRunId(null), ARRIVAL_TOTAL_MS + 60)
        return () => clearTimeout(timer)
    }, [glowRunId, animated])

    const bandWidth = resolveBandWidth(cardWidth)
    const showBand = !!glowRunId && animated && cardWidth > 0

    return {
        onCardLayout: event => {
            const width = event?.nativeEvent?.layout?.width
            if (typeof width === 'number' && width !== cardWidth) setCardWidth(width)
        },
        contentStyle: {
            opacity: rise,
            transform: [
                {
                    translateY: rise.interpolate({
                        inputRange: [0, 1],
                        outputRange: [RISE_DISTANCE, 0],
                    }),
                },
            ],
        },
        badgeStyle: {
            transform: [
                {
                    scale: badge.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.4, 1],
                    }),
                },
            ],
        },
        showBand,
        bandStyle: {
            width: bandWidth,
            backgroundImage: arrivalBandBackground,
            transform: [
                {
                    translateX: glow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-bandWidth, cardWidth],
                    }),
                },
            ],
        },
    }
}
