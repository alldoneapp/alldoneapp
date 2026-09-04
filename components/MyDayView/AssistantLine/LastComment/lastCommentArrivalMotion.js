import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'
import { LAST_COMMENT_PREVIEW_HEIGHT } from './lastCommentLayout'

/**
 * AT-2511 — the motion the Last comment card plays when a comment it has never shown lands in it.
 *
 * The slot is the payoff of the whole assistant line: you type a line, the composer empties
 * (AT-2504), the pending card says "working on it", and then the answer appears — by silently
 * swapping its text, indistinguishable from a re-render. This gives that moment a shape, and the
 * shape is a **ticker roll**: the comment that was on screen rolls UP and out of the card while the
 * new one rolls in from below, like a departure board.
 *
 * That is a deliberate product choice over the quieter alternatives (a fade, a highlight pulse, a
 * rise-into-place). A roll is unambiguous — it says "this was REPLACED", which is exactly what
 * happened — and it needs no colour to say it, so nothing has to compete with the unread badge for
 * the "this is new" signal.
 *
 * The beats:
 *
 *   1. ROLL (t=0, 420ms) — both rows travel together, driven by ONE `Animated.Value`, so they can
 *      never drift apart: outgoing `0 → -H`, incoming `+H → 0`, where H is the card's own measured
 *      height. `Easing.inOut` rather than a spring — a roll that overshoots would pull the incoming
 *      row back down and briefly expose a gap under it, and a departure board reads as mechanical
 *      anyway.
 *   2. POP (t=120, 260ms) — the unread badge scales up from 0.4 through a small overshoot. It is
 *      the one element that carries the "new" information and the one element OUTSIDE the clip, so
 *      it is the one thing allowed to overshoot.
 *
 * ~540ms in total, none of which delays anything: unlike `taskCompletionMotion` there is no write
 * being held here. The comment is already stored and already interactive — tapping the card during
 * the roll opens the thread exactly as before.
 *
 * ## Geometry
 *
 * Everything is `transform`, and the card's fixed `LAST_COMMENT_PREVIEW_HEIGHT` contract is
 * preserved to the pixel, so the assistant line cannot reflow. The roll is clipped by a viewport
 * that fills the CARD's whole box rather than its content box — see `LastAssistantComment` — which
 * is both what keeps the unread badge (at `top/right: -5`, outside the card) unclipped, and what
 * keeps `ProjectTagIndicator` measured against the same edges as before.
 *
 * ## Reduced motion, and renderers that cannot measure
 *
 * `prefers-reduced-motion` renders the finished frame directly: the new comment, in place, with no
 * outgoing row mounted at all. Nothing is lost — "this is new" is carried by the unread badge,
 * which is a static element.
 *
 * H falls back to the card's known constant height when `onLayout` has not reported (jest computes
 * no layout, and the compact chip is 24px), so the roll distance is never a guess.
 */

export const ROLL_DURATION_MS = 420
export const BADGE_DELAY_MS = 120
export const BADGE_DURATION_MS = 260
export const ARRIVAL_TOTAL_MS = Math.max(ROLL_DURATION_MS, BADGE_DELAY_MS + BADGE_DURATION_MS)

// The compact chip's own height (`compactContainer`), used when nothing has been measured yet.
export const COMPACT_CARD_HEIGHT = 24

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

export const resolveRollDistance = (measuredHeight, compact) =>
    measuredHeight > 0 ? measuredHeight : compact ? COMPACT_CARD_HEIGHT : LAST_COMMENT_PREVIEW_HEIGHT

/**
 * Which comment, if any, should be rolling AWAY — given the card's own two-slot history and the
 * comment it is rendering right now.
 *
 * `null` is a first-class answer and is the honest one whenever the card cannot name a different
 * comment it was previously showing. That covers the ordinary remount: a comment landing in another
 * chat (a heartbeat, a VM result, the AT-2504 pending → reply handoff) replaces this subtree, so the
 * card is BORN already showing the new comment and there was never an old one on screen here. The
 * incoming row still rolls up into place — `rolling` gates only whether an outgoing row is mounted,
 * never whether the animation runs — so the arrival is still announced, without inventing a
 * departure that did not happen.
 *
 * The equality guard is the belt to that braces: a phantom row carrying the SAME text as the one
 * arriving is indistinguishable from a rendering glitch, and reads far worse than no roll at all.
 */
export const resolveOutgoingRow = (rows, currentRow) => {
    const arriving = currentRow?.commentText
    // Most recent first. Which of the two slots holds the departing comment depends on whether the
    // arrival id reached this card in the same commit as the text it describes (it does not, in the
    // app — see `rowsRef` below), so the rule is stated once as "the newest one that is not the
    // comment arriving" rather than as two cases that could drift apart.
    return [rows?.shown, rows?.previous].find(row => row && row.commentText !== arriving) || null
}

/**
 * @param arrivalId a fresh number per arrival (see `lastCommentArrival.js`), or null for "nothing
 *        has arrived". A number rather than a boolean so two arrivals in a row restart the roll.
 * @param row       the comment currently being rendered. A two-entry history of it is kept (see
 *        `rowsRef`) so that, on the render an arrival lands, the previous DISTINCT comment is still
 *        available to roll away — whether the id arrived with the text or one commit behind it.
 */
export const useLastCommentArrivalMotion = (arrivalId, row = null, compact = false) => {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()

    // Rest state is the FINISHED frame (1), not the starting one: a card that has not received an
    // arrival — every first paint, every reload — must render complete and unanimated, and a value
    // seeded at 0 would leave it rolled off the top on any renderer where the animation never runs.
    const roll = useRef(new Animated.Value(1)).current
    const badge = useRef(new Animated.Value(1)).current
    const [cardHeight, setCardHeight] = useState(0)
    const [run, setRun] = useState({ id: null, outgoing: null })

    /**
     * The last TWO distinct comments this card has painted — not "whatever was painted last time".
     *
     * The distinction is the whole point, and a one-slot ref gets it wrong in the app while looking
     * right in a test. `arrivalId` does NOT arrive in the same commit as the comment it describes:
     * the container publishes it from an effect (`useLastCommentArrival`), so the new text paints in
     * commit N and the id only lands in commit N+1. A ref overwritten on every commit has therefore
     * already been advanced to the NEW row by the time the card arms, and the "departure board"
     * rolled the fresh answer out from under itself — two identical rows, which passes every
     * positional assertion there is.
     *
     * Advancing only when the displayed comment actually changes keeps the previous one available
     * across that one-commit gap. `commentText` is the identity because it is what the roll shows,
     * and it is the same thing `buildLastCommentKey` calls an arrival.
     */
    const rowsRef = useRef({ shown: row, previous: null })
    useEffect(() => {
        if (rowsRef.current.shown?.commentText !== row?.commentText) {
            rowsRef.current = { shown: row, previous: rowsRef.current.shown }
        }
    })

    /**
     * Armed by a RENDER-PHASE state update (React's documented "adjust state when a prop changes"),
     * not from an effect — the same pattern `useProjectCompletedSweep` uses and for the same
     * reason. An effect runs after the commit that has ALREADY painted the new comment in place, so
     * the user would see the answer appear and only then watch the old one roll away from
     * underneath it. Here the very first painted frame of an arrival already has both rows.
     */
    if (animated && arrivalId && arrivalId !== run.id) {
        setRun({ id: arrivalId, outgoing: resolveOutgoingRow(rowsRef.current, row) })
    }

    /**
     * A LAYOUT effect, not a passive one — and the browser harness is what proved it has to be.
     *
     * The render-phase arm above mounts both rows in the right commit, but the animation's values
     * are still at their RESTING frame during it. A passive effect runs after paint, so the first
     * painted frame of every arrival showed the new comment already in place and the old one
     * already gone; only the frame after that jumped back to the start of the roll. Measured in
     * `browser-tests/at2511` as `outgoing y: -90` on frame 0 followed by `-0.06` on frame 1 — i.e.
     * the answer appeared, then visibly fell back down to roll in again.
     *
     * A layout effect runs after the DOM is updated and BEFORE the browser paints, so the start
     * frame is the first thing on screen. This is the same reason AT-2418 claims its celebration
     * marker in a layout effect rather than a passive one.
     */
    useLayoutEffect(() => {
        if (!run.id) return undefined

        if (!animated) {
            roll.setValue(1)
            badge.setValue(1)
            return undefined
        }

        roll.setValue(0)
        badge.setValue(0)

        const animation = Animated.parallel([
            Animated.timing(roll, {
                toValue: 1,
                duration: ROLL_DURATION_MS,
                easing: Easing.inOut(Easing.cubic),
                useNativeDriver: false,
            }),
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
    }, [run.id, animated, roll, badge])

    /**
     * The outgoing row is unmounted once it has left. Keeping it would leave a second copy of the
     * comment parked off-screen inside the clip forever — invisible, but still subscribed to redux
     * through its hashtag/mention/project tags.
     *
     * Note it clears the ROW and keeps the `id`. Resetting the id would make the arm condition
     * above true again on the very next render — `arrivalId` has not changed, it is still the one
     * that was just handled — so the card would roll the same comment away a second time, and then
     * a third, for as long as it stayed mounted.
     */
    useEffect(() => {
        if (!run.id || !animated) return undefined
        const timer = setTimeout(
            () => setRun(current => (current.id === run.id ? { ...current, outgoing: null } : current)),
            ROLL_DURATION_MS + 60
        )
        return () => clearTimeout(timer)
    }, [run.id, animated])

    const distance = resolveRollDistance(cardHeight, compact)
    const rolling = !!run.id && !!run.outgoing && animated

    return {
        onCardLayout: event => {
            const height = event?.nativeEvent?.layout?.height
            if (typeof height === 'number' && height !== cardHeight) setCardHeight(height)
        },
        // The comment rolling away, or null when nothing is rolling.
        outgoingRow: rolling ? run.outgoing : null,
        /**
         * The ONE value both rows interpolate. Exposed so a test can drive the roll by hand — jest
         * stubs `Animated.timing` into a no-op, so a run never advances there and "the two rows
         * move in lockstep" would otherwise only be assertable at its start frame.
         */
        rollValue: roll,
        outgoingStyle: {
            transform: [
                {
                    translateY: roll.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -distance],
                    }),
                },
            ],
        },
        incomingStyle: {
            transform: [
                {
                    translateY: roll.interpolate({
                        inputRange: [0, 1],
                        outputRange: [distance, 0],
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
    }
}
