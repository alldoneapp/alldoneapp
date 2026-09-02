import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet } from 'react-native'

import { colors, hexColorToRGBa } from '../../styles/global'

/**
 * AT-2382 — the shared animation contract for every loading ghost in the app.
 *
 * Two layers run at once, and that redundancy is deliberate rather than decorative:
 *
 *   1. A CSS shimmer sweep (`ghostShimmerStyles.sweep`). react-native-web 0.21 compiles
 *      `animationKeyframes` into a real `@keyframes` rule, so the highlight band is
 *      composited by the browser: zero JS per frame, and it cannot jank while the
 *      Firestore snapshot that the ghost is covering lands and re-renders the list.
 *   2. An `Animated` opacity pulse (`useGhostPulse`). This is the pre-existing
 *      convention in this codebase (TaskListSkeleton, EmailChipsSkeleton,
 *      MeetingBookingPage) and it is kept underneath the sweep as the fallback: on any
 *      renderer that drops `animationKeyframes` — the real `react-native` StyleSheet
 *      under jest, or a future RNW that tightens its style allowlist — the ghost still
 *      visibly animates instead of silently freezing into a grey slab.
 *
 * Both layers stand down for `prefers-reduced-motion`, and both are inert under jest so
 * suites never have to advance timers to reach a stable tree.
 */

// Kept in sync with the sweep duration so the two layers beat together rather than
// against each other.
const PULSE_DURATION_MS = 700
const PULSE_MIN_OPACITY = 0.55
const PULSE_MAX_OPACITY = 1
const USE_NATIVE_DRIVER = Platform.OS !== 'web'
// The value a frozen ghost rests at. Sitting between the two extremes reads as
// "deliberately dimmed" rather than "half-rendered".
export const GHOST_STATIC_OPACITY = 0.7

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * The preference as the browser can answer it RIGHT NOW, with no round trip.
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` returns a Promise, so a hook seeded from it alone
 * spends its first commit assuming motion is allowed and corrects a microtask later. For a ghost
 * that only ever meant one wrong frame. For a celebration it is worse: AT-2492 claims its
 * once-per-day marker in a layout effect on that first commit, so it would spend the day believing
 * it was about to animate and then discover it must not — the day is handed back, but only because
 * something remembered to hand it back. Reading the media query synchronously removes the window
 * instead of compensating for it.
 *
 * Falls back to `false` (motion allowed) when the question cannot be asked here, which is the safe
 * direction for a first frame: the async answer below still corrects it, and the alternative —
 * react-native-web's own `isReduceMotionEnabled`, which resolves to TRUE when `matchMedia` is
 * missing — would silently disable animation for an environment that merely could not answer.
 */
const currentReducedMotionPreference = () => {
    try {
        return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? !!window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false
    } catch (error) {
        return false
    }
}

/**
 * `AccessibilityInfo.isReduceMotionEnabled()` maps to `prefers-reduced-motion` on
 * react-native-web. Lifted out of TaskListSkeleton so every ghost honours it, and so the
 * subscribe/unsubscribe dance (the API changed shape across RN versions) exists once.
 */
export const useReducedMotion = () => {
    const [reducedMotion, setReducedMotion] = useState(currentReducedMotionPreference)

    useEffect(() => {
        let mounted = true
        const updatePreference = value => {
            if (mounted) setReducedMotion(!!value)
        }

        if (AccessibilityInfo.isReduceMotionEnabled) {
            Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(updatePreference)
        }

        const subscription = AccessibilityInfo.addEventListener
            ? AccessibilityInfo.addEventListener('reduceMotionChanged', updatePreference)
            : null

        return () => {
            mounted = false
            if (subscription?.remove) subscription.remove()
            else if (AccessibilityInfo.removeEventListener) {
                AccessibilityInfo.removeEventListener('reduceMotionChanged', updatePreference)
            }
        }
    }, [])

    return reducedMotion
}

/**
 * One `Animated.Value` per ghost group drives every block in it, so a 6-row ghost costs
 * one animation rather than thirty.
 */
export const useGhostPulse = () => {
    const pulse = useRef(new Animated.Value(GHOST_STATIC_OPACITY)).current
    const reducedMotion = useReducedMotion()

    useEffect(() => {
        if (animationsAreDisabled() || reducedMotion) {
            pulse.setValue(GHOST_STATIC_OPACITY)
            return undefined
        }

        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: PULSE_MAX_OPACITY,
                    duration: PULSE_DURATION_MS,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: USE_NATIVE_DRIVER,
                }),
                Animated.timing(pulse, {
                    toValue: PULSE_MIN_OPACITY,
                    duration: PULSE_DURATION_MS,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: USE_NATIVE_DRIVER,
                }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [pulse, reducedMotion])

    return { pulse, reducedMotion }
}

// The band is half the width of the block it travels across, and it is translated in
// percentages OF ITSELF — so -140% parks it fully clear of the left edge and 340% fully
// clear of the right, independent of how wide the block actually renders. That is what
// lets one shared stylesheet shimmer a 24px checkbox and a 60%-wide title bar identically
// without measuring either of them.
const SWEEP_WIDTH = '50%'
const SWEEP_FROM = '-140%'
const SWEEP_TO = '340%'
const SWEEP_DURATION = '1.4s'

const highlight = hexColorToRGBa('#FFFFFF', 0.92)
const transparent = hexColorToRGBa('#FFFFFF', 0)

export const ghostShimmerStyles = StyleSheet.create({
    sweep: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: SWEEP_WIDTH,
        // `backgroundImage` is not one of react-native-web's blocked shorthands, so it
        // survives style processing verbatim (the same mechanism react-native-web-linear-
        // gradient relies on). Under plain react-native it is simply an unknown key.
        backgroundImage: `linear-gradient(90deg, ${transparent} 0%, ${highlight} 50%, ${transparent} 100%)`,
        // NOTE: inside `animationKeyframes` the transform must be a CSS *string*.
        // react-native-web does not run keyframe steps through its transform serializer,
        // so the normal `[{ translateX: … }]` array form stringifies to the literal
        // `transform: [object Object]` — a rule the browser drops, leaving a static band
        // and no error anywhere. Verified against the compiled sheet; keep it a string.
        animationKeyframes: [
            {
                '0%': { transform: `translateX(${SWEEP_FROM})` },
                '100%': { transform: `translateX(${SWEEP_TO})` },
            },
        ],
        animationDuration: SWEEP_DURATION,
        animationIterationCount: 'infinite',
        animationTimingFunction: 'ease-in-out',
    },
})

export const ghostBaseStyles = StyleSheet.create({
    block: {
        backgroundColor: colors.Grey300,
        // Every ghost block clips its own sweep; without this the highlight band would
        // bleed across the gaps between blocks and read as one moving stripe.
        overflow: 'hidden',
    },
    softBlock: {
        backgroundColor: colors.Grey200,
        overflow: 'hidden',
    },
})
