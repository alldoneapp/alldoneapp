import { useLayoutEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'

/**
 * AT-2445 — the motion the "you have reached empty inbox across all your projects" block plays the
 * first time you see it on a day you earned it.
 *
 * Why this exists on top of AT-2418's dot. That work moved the celebration onto the one element that
 * genuinely changes when you reach empty inbox — an 11px square in the streak grid turning green —
 * and it is right that this is what changes. But the grid sits inside a card, several blocks down a
 * page whose headline is the congratulation itself, and today's cell is at the far RIGHT of a
 * 53-column year. The reward was landing somewhere nobody was looking, which is why the report on
 * this task is "I still don't see an animation" rather than "the animation is wrong".
 *
 * So the arrival is staged where the eye already is — the congratulation — and the dot keeps its
 * beat as the detail you find when you look down. Deliberately ONE event, not two: the same run id
 * drives both, so the confetti and the dot are the same celebration seen at two scales.
 *
 * Two beats, ~3000ms, in the order the eye travels:
 *
 *   • HEADLINE — the congratulation rises, scales up from just under full size and fades in. Small:
 *     it is a line of text, and text that bounces reads as a toast, not as an achievement.
 *   • CONFETTI — a burst thrown up and out from behind the headline, plus a fall across the whole
 *     page over it. This is the beat that is actually VISIBLE from across a room, and the one thing
 *     the previous passes did not have anywhere.
 *
 * AT-2460 lengthened both. The 1500ms version was over before you had finished reading the line it
 * was celebrating, and its confetti never left a block a few hundred pixels wide, so on a desktop
 * board it read as a small flourish next to the headline rather than as an event. The budget is now
 * ~3s: long enough for a piece launched at the top of the viewport to fall out of the bottom of it,
 * short enough that the board is never something you are waiting on — nothing here blocks input,
 * and every layer is `pointerEvents: none`.
 *
 * Anna's "all projects done" illustration is deliberately NOT animated. It is a 460px image sized by
 * its own `flex: 1` / `width: '100%'`, which any wrapper put around it would have to reproduce
 * exactly, and it is the least important beat — not worth a layout risk on the one screen this task
 * is about.
 *
 * The bar this has to clear is the retired full-screen Giphy overlay (AT-2404): a random 300px GIF
 * portalled over the middle of the screen. That was unmissable and awful — it interrupted, it
 * covered content, it needed a network round trip, and it fired on every single completion. This
 * one is confined to a block the user is already looking at, renders from local values, and fires
 * at most once a day.
 */

// The headline is on screen first and is the anchor everything else is timed against.
export const HEADLINE_MS = 520
// Long enough for the slowest piece to cross a tall desktop viewport top to bottom. Everything the
// page layer does is derived from this one value, so the fall speed is a property of the duration
// rather than of a per-piece constant that could drift away from it.
export const CONFETTI_MS = 2900
// Everything is over by here, plus a buffer so the settle cannot clip the last frame.
export const CONGRATS_TOTAL_MS = CONFETTI_MS + 100

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * Owns every `Animated.Value` for the congrats celebration in one place and hands them to the parts
 * that render them, for the same reason `emptyInboxDotMotion` does: the headline and the confetti
 * are one event, and two independently started animations would read as exactly that.
 *
 * @param {number} runId 0 for "nothing to celebrate", otherwise the run to play once. Shared with
 *   the achievement card's dot, so the two beats belong to the same celebration.
 * @returns {{entrance: Animated.Value, confetti: Animated.Value, animated: boolean, celebrating: boolean}}
 */
export default function useEmptyInboxCongratsCelebration(runId) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const [celebrating, setCelebrating] = useState(false)

    // Native driver throughout: transform and opacity only.
    const entrance = useRef(new Animated.Value(1)).current
    const confetti = useRef(new Animated.Value(0)).current

    const settledRunRef = useRef(0)

    useLayoutEffect(() => {
        // A run plays once. Without this, the reduced-motion preference resolving mid-run — it
        // arrives from a promise, so it can land after the run has started — would re-enter and
        // replay the whole thing from the top.
        if (!runId || settledRunRef.current === runId) return undefined

        // Reduced motion keeps the INFORMATION and drops the motion: the congratulation is simply
        // there, which is also exactly what a reload renders. Confetti carries nothing at all, so it
        // is not rendered rather than rendered still.
        if (!animated) {
            settledRunRef.current = runId
            entrance.setValue(1)
            confetti.setValue(0)
            setCelebrating(false)
            return undefined
        }

        setCelebrating(true)
        entrance.setValue(0)
        confetti.setValue(0)

        const animation = Animated.parallel([
            Animated.timing(entrance, {
                toValue: 1,
                duration: HEADLINE_MS,
                // Linear driver: the shape of each beat lives in the interpolations that consume it,
                // so the staging can be re-tuned without touching this sequence.
                easing: Easing.linear,
                useNativeDriver: false,
            }),
            Animated.timing(confetti, {
                toValue: 1,
                duration: CONFETTI_MS,
                easing: Easing.linear,
                useNativeDriver: false,
            }),
        ])

        animation.start()

        // A TIMER, not the animation's completion callback — the same lesson AT-2404 and AT-2418
        // both learned: the settle has to happen identically on every path, including a renderer
        // whose composite never reports finishing. The cost of being wrong here is confetti frozen
        // mid-air over the board.
        const settleTimer = setTimeout(() => {
            settledRunRef.current = runId
            setCelebrating(false)
            entrance.setValue(1)
            confetti.setValue(0)
        }, CONGRATS_TOTAL_MS)

        return () => {
            clearTimeout(settleTimer)
            animation.stop()
        }
    }, [runId, animated])

    return { entrance, confetti, animated, celebrating }
}
