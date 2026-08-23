import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2404 — the motion a task row plays when it is checked off.
 *
 * Before this, ticking a task did something genuinely odd: `CheckBoxWrapper` held the Firestore
 * write for 2000ms (`ANIMATION_DURATION`, borrowed from the Giphy overlay) and the ROW itself did
 * nothing at all for those two seconds — no strike-through, no colour, no exit. It sat there
 * looking untouched apart from the tick, and then vanished mid-blink when the snapshot landed. The
 * hold already existed; it was simply unused.
 *
 * Three beats, deliberately short (~560ms of motion inside a 700ms hold):
 *
 *   1. STRIKE (300ms) — a line sweeps left→right across the title. `scaleX` on a single node with
 *      `transformOrigin: 'left'`, so however many lines the title wraps to, one native-driven
 *      animation draws through all of them together.
 *   2. SETTLE — a very faint green wash confirms the row was accepted. It is `UtilityGreen125` at
 *      low alpha rather than a saturated success colour: this fires on every single completion,
 *      including a user clearing fifteen rows in a row, so it has to be quieter than
 *      `useLastAddedTaskColor`'s 600ms `UtilityBlue125` flash — an event that happens far less
 *      often and therefore earns more attention than this one does.
 *   3. COLLAPSE (260ms) — opacity to 0 while the row's measured height animates to 0, so the list
 *      closes the gap instead of the row popping out from under the cursor.
 *
 * The row is fully collapsed and invisible by ~560ms, ~140ms before the write is issued at 700ms.
 * That buffer is the point: whatever the snapshot then does to the list happens behind a row that
 * is already gone, so the unmount can never interrupt the animation halfway.
 *
 * WHY 700ms AND NOT THE OLD 2000ms — the hold is dead time. The task is finished, the user has
 * moved on, and anything longer makes clearing a list feel like waiting. Undo is unaffected: it is
 * a 10s bar backed by 7-day retention (`utils/undo/`), entirely independent of this timing.
 *
 * NOTE the row is NOT removed by this animation. Nothing in the app removes a completed row — it
 * disappears because the Firestore `inDone == false` query stops matching it. This only has to make
 * the row look gone before that happens.
 */

// One node, native driver, `transformOrigin: 'left'`.
export const STRIKE_DURATION_MS = 300
// Starts as the strike lands rather than after it, so the two read as one gesture.
export const COLLAPSE_DELAY_MS = 300
export const COLLAPSE_DURATION_MS = 260
// 300 + 260 = 560ms of motion, then ~140ms of buffer before the write.
export const COMPLETION_HOLD_MS = 700

/**
 * `prefers-reduced-motion` and jest both get the strike-through as a STATIC line — the information
 * survives, the motion does not, matching the split `TaskRoutingActivityOverlay` already draws
 * between its overlay (decoration) and `TaskRoutingTag` (the message).
 *
 * The hold still exists so the line is actually perceptible before the row leaves; it is just short
 * enough not to read as lag. Zero would mean a reduced-motion user sees no completion feedback at
 * all, which is the accessibility failure this branch exists to avoid.
 */
export const REDUCED_MOTION_HOLD_MS = 250

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * Owned by `TaskPresentation` (the row) but triggered from `CheckBoxWrapper` (the checkbox, several
 * levels down), so `begin` is threaded down as a prop rather than shared through redux or a module
 * store. A redux slice keyed by task id would re-render every mounted row on every completion —
 * exactly the fan-out AT-2336 exists to prevent — for state that only ever concerns one row and
 * lives for 700ms.
 *
 * `begin` RETURNS the number of ms the caller should wait before writing. That keeps every timing
 * decision, including the reduced-motion branch, inside this module: `CheckBoxWrapper` never has to
 * ask whether motion is enabled, it just waits for however long it is told.
 */
export default function useTaskCompletionMotion() {
    const reducedMotion = useReducedMotion()

    const [completion, setCompletion] = useState(null)
    const [collapsing, setCollapsing] = useState(false)

    // Native driver: transform only, and never shared with the height/opacity pair below. Mixing
    // drivers on one Animated.Value throws at runtime.
    const strike = useRef(new Animated.Value(0)).current
    // Non-native: `height` cannot be driven natively, and opacity rides with it on the same node so
    // both stay on the same driver.
    const opacity = useRef(new Animated.Value(1)).current
    const height = useRef(new Animated.Value(0)).current

    const rowHeightRef = useRef(0)
    const animationRef = useRef(null)

    // The row is *expected* to unmount shortly after the motion finishes — that is the snapshot
    // arriving and dropping the completed task from the list. But it can also unmount early (a
    // project switch, a filter change, a re-sort), and an animation left running against a detached
    // node is exactly the "post-unmount update" the surrounding component already guards timeouts
    // against. Stopping is cheap and makes the teardown symmetric.
    useEffect(() => {
        return () => {
            animationRef.current?.stop()
            animationRef.current = null
        }
    }, [])

    // Last known laid-out height of the whole row. Read only at the moment a completion starts, so
    // the per-layout write costs nothing.
    const onRowLayout = useCallback(event => {
        const measured = event?.nativeEvent?.layout?.height
        if (measured) rowHeightRef.current = measured
    }, [])

    const reset = useCallback(() => {
        animationRef.current?.stop()
        animationRef.current = null
        strike.setValue(0)
        opacity.setValue(1)
        height.setValue(0)
        setCollapsing(false)
        setCompletion(null)
    }, [strike, opacity, height])

    /**
     * @param {object} options
     * @param {boolean} options.strikeThrough Whether the title should be crossed out. False when the
     *   checkbox advances a WORKFLOW task to its next step: the row is leaving this list, but the
     *   task is not done and must not be shown as if it were. It still fades and collapses, so the
     *   exit is smooth either way.
     * @returns {number} ms to wait before persisting.
     */
    const begin = useCallback(
        ({ strikeThrough = true } = {}) => {
            const staticOnly = reducedMotion || animationsAreDisabled()
            setCompletion({ strikeThrough, animated: !staticOnly })

            if (staticOnly) {
                strike.setValue(1)
                return REDUCED_MOTION_HOLD_MS
            }

            const measuredHeight = rowHeightRef.current
            strike.setValue(0)
            opacity.setValue(1)

            const beats = [
                Animated.timing(strike, {
                    toValue: 1,
                    duration: STRIKE_DURATION_MS,
                    // Fast out of the gate, easing into the far edge — a line being drawn, rather
                    // than a bar sliding in at constant speed.
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]

            // A row that has never been laid out (measured height 0) still strikes and fades; it
            // just cannot collapse, because animating to 0 from an unknown start would jump.
            if (measuredHeight > 0) {
                height.setValue(measuredHeight)
                setCollapsing(true)
                beats.push(
                    Animated.sequence([
                        Animated.delay(COLLAPSE_DELAY_MS),
                        Animated.parallel([
                            Animated.timing(height, {
                                toValue: 0,
                                duration: COLLAPSE_DURATION_MS,
                                easing: Easing.in(Easing.quad),
                                useNativeDriver: false,
                            }),
                            Animated.timing(opacity, {
                                toValue: 0,
                                // Beats the height so the row is invisible before it is flat —
                                // fading and shrinking at the same rate reads as a squash.
                                duration: COLLAPSE_DURATION_MS - 60,
                                easing: Easing.in(Easing.quad),
                                useNativeDriver: false,
                            }),
                        ]),
                    ])
                )
            }

            const animation = Animated.parallel(beats)
            animationRef.current = animation
            animation.start()

            return COMPLETION_HOLD_MS
        },
        [reducedMotion, strike, opacity, height]
    )

    // Only applied while collapsing. Left off otherwise so the row is never pinned to a stale
    // measured height during ordinary renders.
    const rowStyle = collapsing ? { height, opacity, overflow: 'hidden' } : undefined

    return {
        onRowLayout,
        rowStyle,
        beginCompletionMotion: begin,
        cancelCompletionMotion: reset,
        // Consumed by TitleContainer: null for the overwhelming majority of rows, so the strike
        // overlay is not even mounted until the row is actually being completed.
        completionStrike: completion?.strikeThrough ? { progress: strike, animated: completion.animated } : null,
        isCompleting: !!completion,
    }
}
