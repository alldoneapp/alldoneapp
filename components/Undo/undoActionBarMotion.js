import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2503 — show/hide motion for the Undo notification (`UndoActionBar`).
 *
 * Before this, the banner had no transition in either direction: `if (!visible || !action) return
 * null` put a 48px card over the top of the app on one frame and took it away on another. A toast
 * that teleports in is easy to miss entirely — which matters here more than for most decoration,
 * because the thing it is offering is a ten-second window to take an action back.
 *
 * Four decisions, in the order they were made:
 *
 *   • FOUR VARIANTS, PICKED AT RANDOM, AND THE EXIT MIRRORS THE ENTRY. The banner leaves the way it
 *     arrived — something that drops in lifts back out, something that glides in from the right
 *     glides back out to the right — so an appearance reads as one object with a beginning and an
 *     end rather than as two unrelated effects. Picking the exit independently was considered and
 *     rejected for exactly that reason.
 *   • THE PICK NEVER REPEATS THE PREVIOUS ONE (`pickUndoAnimationVariantId`). Uniform sampling from
 *     four options shows the same animation twice in a row a quarter of the time, and two identical
 *     arrivals back to back is precisely when a user concludes there is only one animation. The
 *     no-repeat rule is what makes the variety perceptible at the rate this banner actually fires.
 *   • SNAPPY, WITH A SMALL OVERSHOOT. 260ms in, 180ms out. Every entry travels slightly past its
 *     resting place and settles back, which is what reads as "physical" rather than "faded in". The
 *     budget is deliberately under the ~300ms mark where a transition starts to feel like waiting —
 *     this is an interruption the user did not ask for, and it sits on top of their work.
 *   • A CONTENT CHANGE IS A NUDGE, NOT A RE-ENTRY. Pressing Undo leaves the banner exactly where it
 *     is and changes its text to "Undone: …". Replaying the entry would move the Undo/Redo button
 *     out from under the cursor mid-interaction, so instead the card gives a ~3% scale beat and the
 *     new text fades up. Same information, nothing moves away from the pointer.
 *
 * NOTHING HERE CHANGES LAYOUT. Every variant is `opacity` + `transform` only, so the banner cannot
 * push, reflow or resize anything underneath it at any point in its life, and the app behind it is
 * never relaid out because a toast appeared.
 *
 * Reduced motion stands the whole module down — see `useUndoActionBarMotion`.
 */

// 260 / 180: quick enough not to read as latency, long enough for the overshoot to be legible. The
// exit is deliberately the shorter of the two — an arrival is an offer worth noticing, a departure
// is the toast getting out of the way, and a slow one is just clutter.
export const UNDO_ENTER_MS = 260
export const UNDO_EXIT_MS = 180
// The beat for a status flip (Undo → "Undone: …") or an error replacing the label.
export const UNDO_NUDGE_MS = 220
// Buffer past the exit so the settle that unmounts the banner can never clip its own last frame.
export const UNDO_EXIT_SETTLE_BUFFER_MS = 60

/**
 * How long the banner stays up before hiding itself. Lives here rather than in the component
 * because the auto-hide timer and the countdown line that visualises it must be the same number:
 * a bar that empties before or after the banner actually leaves is worse than no bar at all.
 */
export const UNDO_DISPLAY_TIME_MS = 10000

/**
 * The values a settled banner sits at. Every variant must start its exit here and end its entry
 * here, or an appearance would leave the card permanently displaced, rotated or invisible —
 * `undoActionBarMotion.test.js` pins exactly that for all four.
 */
export const UNDO_MOTION_REST = { opacity: 1, translateX: 0, translateY: 0, scale: 1, rotate: '0deg' }

// Serialised in this order into the `transform` array. Order matters in CSS: rotating after
// translating rotates about the card's own centre, which is what the tilt variant wants.
export const UNDO_TRANSFORM_ORDER = ['translateX', 'translateY', 'scale', 'rotate']

/**
 * Each variant is pure DATA — an interpolation per animated channel — rather than a function that
 * builds an animation. Two reasons. The geometry becomes exhaustively testable in jest without a
 * renderer (`__mocks__/react-native.js` stubs `Animated.timing` to a no-op, so no jest test can
 * watch one of these actually run), and adding a fifth variant is a keyframe block rather than a
 * new code path.
 *
 * Both directions run their driver 0 → 1. For `enter`, 0 is "off stage" and 1 is at rest; for
 * `exit`, 0 is at rest and 1 is gone.
 */
export const UNDO_ANIMATION_VARIANTS = {
    /** Falls from above the resting place and settles back up into it. The default reading of a
     *  banner that lives at the top of the window. */
    drop: {
        enter: {
            opacity: { inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] },
            translateY: { inputRange: [0, 0.55, 1], outputRange: [-30, 5, 0] },
        },
        exit: {
            opacity: { inputRange: [0, 0.55, 1], outputRange: [1, 0.3, 0] },
            translateY: { inputRange: [0, 1], outputRange: [0, -24] },
        },
    },
    /** No travel at all: scales up through a small overshoot. The quietest of the four, and the one
     *  that never moves the Undo button horizontally or vertically on the way in. */
    pop: {
        enter: {
            opacity: { inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] },
            scale: { inputRange: [0, 0.55, 1], outputRange: [0.85, 1.04, 1] },
        },
        exit: {
            opacity: { inputRange: [0, 0.6, 1], outputRange: [1, 0.28, 0] },
            scale: { inputRange: [0, 1], outputRange: [1, 0.92] },
        },
    },
    /** Slides in from the right and leaves to the right. The travel is 44px — enough to read as a
     *  direction, far short of anything that would look like the card flying across the screen. */
    glide: {
        enter: {
            opacity: { inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] },
            translateX: { inputRange: [0, 0.6, 1], outputRange: [44, -6, 0] },
        },
        exit: {
            opacity: { inputRange: [0, 0.55, 1], outputRange: [1, 0.3, 0] },
            translateX: { inputRange: [0, 1], outputRange: [0, 36] },
        },
    },
    /** Drops in slightly askew and straightens out. The rotation is 3.5° — a deliberate ceiling:
     *  rotation is the transform most likely to bother a vestibular-sensitive viewer, so this is
     *  kept to the smallest angle that is still visible, and it is gone entirely under reduced
     *  motion like everything else here. */
    tilt: {
        enter: {
            opacity: { inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] },
            translateY: { inputRange: [0, 0.6, 1], outputRange: [-18, 3, 0] },
            scale: { inputRange: [0, 0.6, 1], outputRange: [0.94, 1.01, 1] },
            rotate: { inputRange: [0, 0.6, 1], outputRange: ['-3.5deg', '0.7deg', '0deg'] },
        },
        exit: {
            opacity: { inputRange: [0, 0.55, 1], outputRange: [1, 0.3, 0] },
            translateY: { inputRange: [0, 1], outputRange: [0, -18] },
            scale: { inputRange: [0, 1], outputRange: [1, 0.96] },
            rotate: { inputRange: [0, 1], outputRange: ['0deg', '2.2deg'] },
        },
    },
}

export const UNDO_ANIMATION_IDS = Object.keys(UNDO_ANIMATION_VARIANTS)

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * Picks the next variant, never repeating the one that just played.
 *
 * `random` is injectable so the rule can be tested without a statistical argument, and the index is
 * clamped rather than trusted: `Math.random()` is documented as `[0, 1)`, but an injected source
 * returning exactly 1 — or a rounding artefact on some engine — would index past the end of the
 * pool and hand the caller `undefined`, which is a crash in the render that consumes it. The cost
 * of the clamp is one comparison; the cost of being wrong is a blank screen behind a toast.
 */
export const pickUndoAnimationVariantId = (previousId, random = Math.random) => {
    const pool = UNDO_ANIMATION_IDS.filter(id => id !== previousId)
    const candidates = pool.length > 0 ? pool : UNDO_ANIMATION_IDS
    const raw = Math.floor(random() * candidates.length)
    const index = Math.min(candidates.length - 1, Math.max(0, Number.isFinite(raw) ? raw : 0))
    return candidates[index]
}

/**
 * Turns a variant's keyframe block into a react-native style driven by one `Animated.Value`.
 *
 * One value drives every channel of a variant, which is the same rule the rest of the app's motion
 * follows (AT-2404, AT-2492): two values, however carefully tuned, eventually read as two
 * animations that happen to overlap.
 */
export const buildUndoMotionStyle = (progress, keyframes, extraTransforms = []) => {
    const style = {}
    if (keyframes?.opacity) style.opacity = progress.interpolate(keyframes.opacity)

    const transform = UNDO_TRANSFORM_ORDER.filter(key => keyframes?.[key]).map(key => ({
        [key]: progress.interpolate(keyframes[key]),
    }))

    const allTransforms = [...transform, ...extraTransforms]
    if (allTransforms.length > 0) style.transform = allTransforms
    return style
}

const variantById = id => UNDO_ANIMATION_VARIANTS[id] || UNDO_ANIMATION_VARIANTS[UNDO_ANIMATION_IDS[0]]

/**
 * Owns every `Animated.Value` the banner uses, plus the mount lifecycle that an exit animation
 * requires: the component can no longer unmount the moment `visible` goes false, because there
 * would be nothing left to animate out. `rendered` is the answer to "is there still something on
 * screen", and it stays true for the length of the exit.
 *
 * REDUCED MOTION STANDS THE WHOLE MODULE DOWN, including the countdown line. The banner simply
 * appears and disappears, which is byte-identical to the behaviour that shipped before AT-2503, and
 * `rendered` then tracks `visible` SYNCHRONOUSLY — no state, no timer, no extra commit. That
 * matters beyond tidiness: a dismiss must remove the banner in the same commit as the press, or a
 * test (and a user) sees a toast that ignored them.
 *
 * The countdown is the one thing here that is not decoration — it says how long is left to press
 * Undo — but it is also ten full seconds of continuous movement, which is the exact shape of motion
 * `prefers-reduced-motion` exists to suppress. It is dropped rather than frozen: a static full-width
 * line states a falsehood, and the information it carries is still available in the plainest
 * possible form, namely that the banner is about to go away.
 *
 * @param {object} params
 * @param {boolean} params.visible Whether the banner SHOULD be on screen. Not whether it is.
 * @param {string} params.contentKey Changes when the message or its action changes → nudge.
 * @param {string} params.countdownKey Changes when the auto-hide timer restarts → refill the line.
 * @param {boolean} params.countdownActive False while no auto-hide timer is running (e.g. busy).
 */
export default function useUndoActionBarMotion({ visible, contentKey, countdownKey, countdownActive }) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()

    // Both directions run 0 → 1; which keyframes read it is decided by `exiting`.
    const progress = useRef(new Animated.Value(1)).current
    // 1 = settled. A nudge drops it to 0 and lets it run back up.
    const nudge = useRef(new Animated.Value(1)).current
    // 0 = full, 1 = drained.
    const countdown = useRef(new Animated.Value(0)).current

    const [variantId, setVariantId] = useState(UNDO_ANIMATION_IDS[0])
    const [exiting, setExiting] = useState(false)

    const previousVariantRef = useRef(null)
    const lastContentKeyRef = useRef(contentKey)
    // Whether the banner has actually been shown. Without it, the first commit (visible === false)
    // would take the exit branch and render a banner nobody asked for.
    const shownRef = useRef(false)
    const exitingRef = useRef(false)

    /**
     * Entry and exit. A layout effect rather than a passive one because the first painted frame has
     * to already be the animation's first frame — a passive effect paints the banner at rest and
     * then snaps it back off stage, which is the flicker AT-2418 documented for the achievement dot.
     */
    useLayoutEffect(() => {
        if (!animated) {
            progress.setValue(1)
            nudge.setValue(1)
            shownRef.current = visible
            lastContentKeyRef.current = contentKey
            if (exitingRef.current) {
                exitingRef.current = false
                setExiting(false)
            }
            return undefined
        }

        if (visible) {
            shownRef.current = true
            if (exitingRef.current) {
                exitingRef.current = false
                setExiting(false)
            }

            const nextId = pickUndoAnimationVariantId(previousVariantRef.current)
            previousVariantRef.current = nextId
            setVariantId(nextId)

            // The entry already presents this content, so it must not also be nudged for it.
            lastContentKeyRef.current = contentKey
            nudge.setValue(1)
            progress.setValue(0)

            const animation = Animated.timing(progress, {
                toValue: 1,
                duration: UNDO_ENTER_MS,
                // Fast out of the gate and slowing into the settle — the half of "snappy with a
                // small overshoot" that the keyframes cannot express on their own.
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            })
            animation.start()
            return () => animation.stop()
        }

        if (!shownRef.current) return undefined
        shownRef.current = false
        exitingRef.current = true
        setExiting(true)
        progress.setValue(0)

        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: UNDO_EXIT_MS,
            // Accelerating away, the mirror of the entry's deceleration into place.
            easing: Easing.in(Easing.cubic),
            useNativeDriver: false,
        })
        animation.start()

        /*
         * A TIMER, not the animation's completion callback — the rule every other motion module
         * here follows (AT-2404, AT-2418, AT-2445). The unmount has to happen identically on the
         * animated path, on a renderer whose composite never reports finishing, and on one whose
         * callback fires late. The cost of being wrong is a banner frozen at 0 opacity that still
         * occupies the top of the window.
         */
        const settle = setTimeout(() => {
            exitingRef.current = false
            setExiting(false)
        }, UNDO_EXIT_MS + UNDO_EXIT_SETTLE_BUFFER_MS)

        return () => {
            clearTimeout(settle)
            animation.stop()
        }
    }, [visible, animated])

    /** The content beat. Skipped on the commit that also brings the banner in — that is an entry. */
    useLayoutEffect(() => {
        if (!animated) return undefined
        if (lastContentKeyRef.current === contentKey) return undefined
        lastContentKeyRef.current = contentKey
        if (!visible || exitingRef.current) return undefined

        nudge.setValue(0)
        const animation = Animated.timing(nudge, {
            toValue: 1,
            duration: UNDO_NUDGE_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
        })
        animation.start()
        return () => animation.stop()
    }, [contentKey, visible, animated])

    /** The countdown line. Restarts whenever the component's auto-hide timer restarts. */
    useEffect(() => {
        countdown.setValue(0)
        if (!animated || !countdownActive) return undefined

        const animation = Animated.timing(countdown, {
            toValue: 1,
            duration: UNDO_DISPLAY_TIME_MS,
            // LINEAR, and it is the only value here that must be: this one is a clock, not a
            // gesture. Any easing would make the remaining time misreport itself.
            easing: Easing.linear,
            useNativeDriver: false,
        })
        animation.start()
        return () => animation.stop()
    }, [countdownKey, countdownActive, animated])

    const variant = variantById(variantId)
    const keyframes = exiting ? variant.exit : variant.enter

    // The nudge rides in the SAME transform array as the variant, composed after it. CSS composes
    // `scale(a) scale(b)` multiplicatively, so a beat during a `pop` entry stacks correctly instead
    // of one overwriting the other — and it costs no extra DOM node to wrap.
    const nudgeTransforms = animated
        ? [{ scale: nudge.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1.028, 1.01, 1] }) }]
        : []

    return {
        /** Render the banner at all? True for the whole exit, so there is something to animate. */
        rendered: animated ? visible || exiting : visible,
        exiting,
        /** Derived, not a fourth piece of state — 'leaving' is the only question worth asking. */
        phase: exiting ? 'leaving' : 'shown',
        animated,
        variantId,
        containerStyle: animated ? buildUndoMotionStyle(progress, keyframes, nudgeTransforms) : null,
        /** The "quick fade of the new text" half of the content beat. */
        messageStyle: animated
            ? { opacity: nudge.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0.2, 0.75, 1] }) }
            : null,
        showCountdown: animated && countdownActive && !exiting,
        /** Drains left-to-right. Paired with `transformOrigin: 'left center'` in the stylesheet. */
        countdownStyle: { transform: [{ scaleX: countdown.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }] },
    }
}
