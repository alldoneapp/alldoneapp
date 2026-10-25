import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import moment from 'moment'

import { EMPTY_INBOX_DATE_FORMAT } from './AchievementsHelper'
import {
    didReachEmptyInbox,
    hasCelebratedEmptyInboxDay,
    markEmptyInboxDayCelebrated,
    releaseEmptyInboxDayCelebration,
} from './emptyInboxCelebrationMarker'
import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'

/**
 * How long a claimed day stays refundable: a run torn down before this is treated as never having
 * played, and the day is handed back.
 *
 * Deliberately a local constant rather than an import of the motion's own duration — this hook
 * decides WHETHER to celebrate and is kept ignorant of the animation — but it must never be shorter
 * than the celebration, or a run cut off halfway would count as seen. The suites of both motions
 * pin that relationship from their side, which is what keeps this number honest without giving this
 * file a dependency on either of them.
 *
 * AT-2460 raised it from 1000ms because the celebration itself grew to ~3s. The direction of the
 * error matters: too long only means a day is occasionally handed back and celebrated again, while
 * too short means a user who navigated away mid-animation has silently spent the day and will never
 * see it.
 */
export const CELEBRATION_CLAIM_SETTLE_MS = 3200

/**
 * AT-2418 — decides WHETHER today's empty-inbox dot should be celebrated, and returns a run id the
 * motion hook can key on. It deliberately knows nothing about the animation itself.
 *
 * The previous version compared `achievedToday` against its own previous render, so it fired only
 * on the false → true flip while mounted. That is one very narrow window: you had to already be on
 * the all-projects board at the instant the Firestore write for the last completed task landed.
 * Clear your inbox from My Day, or from your phone, or simply arrive on the board a second later,
 * and the day's dot appeared with no animation and none was ever shown again. The marker
 * (`emptyInboxCelebrationMarker`) replaces that comparison, which collapses both cases into one
 * rule: celebrate the first time this user sees an achieved today, whenever that is, once per day.
 *
 * `useLayoutEffect`, not `useEffect`, and that is not a micro-optimisation. Today's cell is already
 * on screen and green by the time this decides to celebrate it (the grid is driven by the same
 * `emptyInboxDays` array). A passive effect resolves AFTER paint, so the browser would paint the
 * finished green dot, then the dot would jump back to scale 0 and pop in — the end state flashing
 * before its own entrance. Deciding before paint means the first frame the user sees is the first
 * frame of the animation.
 *
 * StrictMode-safe by construction: a double-invoked effect marks on the first pass and takes the
 * `hasCelebratedEmptyInboxDay` early return on the second, so the run id lands on 1 either way.
 *
 * ── AT-2506: ONCE A DAY WAS THE WRONG UNIT ───────────────────────────────────────────────────────
 *
 * Reaching inbox zero is an EVENT, and it happens more than once a day for anyone who actually
 * works their inbox: you clear it, new mail and new tasks land, you clear it again. AT-2418's rule
 * celebrated the first of those and silently swallowed every one after it, which is what "we should
 * ALWAYS play the animation" is about. So the marker no longer answers on its own — a clearing this
 * hook WATCHED bypasses it, and only an inbox that was already empty when we arrived is subject to
 * it. See the gate for the full argument.
 *
 * The consequence is architectural, and it is why `todayInboxAmount` is a parameter rather than
 * something this hook selects for itself: the empty-inbox block only exists WHILE the inbox is
 * empty, so a detector living inside it mounts at the empty moment and can never see the count it
 * was supposed to compare against. The caller therefore has to be a component that stays mounted
 * across the transition — the boards themselves — which is the same move AT-2445 made when it
 * lifted this decision out of `EmptyInboxOverview`, one level further up.
 *
 * It is also why the amount is passed in rather than derived from `sidebarNumbers` here: the two
 * boards already hold the exact number they use to decide they are empty, and subscribing the
 * 78-project All Projects board to the whole per-project count map is precisely the render fan-out
 * AT-2336 exists to prevent.
 *
 * @param {string[]} emptyInboxDays Normalized `YYYY-MM-DD` achievement days.
 * @param {boolean} enabled Only the empty-inbox board celebrates. The Settings → Profile card
 *   renders the same overview and must neither animate nor CONSUME the once-per-day marker, or
 *   opening your profile would silently spend the celebration the board was going to show you.
 * @param {string} userId Scopes the marker; a second account on the same browser gets its own.
 * @param {number} [todayInboxAmount] AT-2506 — the live today-inbox count of the surface hosting
 *   this hook, so a clearing that happens IN FRONT OF THE USER can be told apart from the empty
 *   board they merely arrived at. Omit it and the hook behaves exactly as it did before: the
 *   once-per-day marker is the only rule. See the AT-2506 block above for why the caller has to be
 *   a component that outlives the empty-inbox block.
 * @returns {number} 0 while there is nothing to celebrate, then a stable non-zero run id.
 */
export default function useTodayEmptyInboxCelebration(emptyInboxDays, enabled, userId, todayInboxAmount) {
    /**
     * AT-2506 — the day may only be claimed for a run that can actually be SEEN.
     *
     * This hook had no reduced-motion check at all, while every motion it starts
     * (`useEmptyInboxCongratsCelebration`, `useEmptyInboxDotCelebration`) stands down under one —
     * so a reduced-motion user claimed the day, was shown nothing, and the marker then suppressed
     * every later view of it. `useProjectCompletedSweep` has always guarded this (`if (!animated)
     * return undefined`, with a comment naming exactly this failure); the all-projects hook was the
     * outlier, and it is the more valuable of the two celebrations to lose.
     *
     * It matters beyond a user preference: react-native-web's `isReduceMotionEnabled()` resolves to
     * TRUE whenever `window.matchMedia` is missing, and it resolves from a PROMISE — so an
     * environment that merely cannot answer the question flips this to `true` a microtask after the
     * first commit. Listing it as a dependency is what makes that late answer hand the day back
     * (the effect re-runs, and its cleanup refunds a claim that has not settled yet) instead of
     * spending it on a run the user never saw.
     *
     * Deliberately NOT also standing down under jest, unlike the per-project hook: there the flag
     * additionally governs `holdProjectLine`, which changes the board's layout. Here it would only
     * mean no suite could ever observe the decision this hook exists to make.
     */
    const reducedMotion = useReducedMotion()
    const todayKey = moment().format(EMPTY_INBOX_DATE_FORMAT)
    const achievedToday = emptyInboxDays.includes(todayKey)
    const [celebrationRunId, setCelebrationRunId] = useState(0)

    /**
     * Is there something to celebrate on screen right now?
     *
     * AT-2506 — the last clause is new, and it exists because `enabled` no longer implies it. The
     * hook used to be reachable only from inside the empty-inbox block, so "the inbox is empty" was
     * a property of being called at all; the boards now call it on every render, full or empty,
     * because that is the only way to see the count fall. The achievement day stays true for the
     * rest of the day once earned, so without this a caller whose `enabled` was slightly wrong
     * would congratulate a board with fifty tasks on it.
     *
     * Deliberately LOOSER than the transition rule — "not a positive count" rather than "exactly
     * zero", the same distinction `projectTodayListLooksClear` draws one scope down. An unknown
     * count (`undefined` before the first snapshot, `null` while the watchers rebuild) is how the
     * ordinary "cleared this morning, opened the board this afternoon" case arrives, and refusing
     * it would break the one thing AT-2418 built this hook for.
     */
    const celebrationIsOnScreen = enabled && achievedToday && !reducedMotion && !(todayInboxAmount > 0)

    /**
     * AT-2445: the day this hook has claimed and not yet watched play out, as `{userId, dayKey}`.
     * It is cleared once the run has been on screen for the settle window — at which point the day
     * is spent for real — and handing it back while it is still set is what stops a run nobody saw
     * from costing the user their celebration.
     *
     * It carries its own identity rather than reading `userId`/`todayKey` from the closure, so the
     * unmount effect below can refund it without listing either as a dependency (which would make
     * "unmount" fire on a day rollover or an account switch instead).
     */
    const claimedRef = useRef(null)
    const settleTimerRef = useRef(null)
    // AT-2506: the previous value of `todayInboxAmount`, so this hook can recognise the clearing
    // itself and not merely its aftermath. Undefined until the first commit, which is exactly why
    // `didReachEmptyInbox` refuses to read an absent previous count as "had tasks".
    const previousAmountRef = useRef(undefined)

    /**
     * Hand back an unsettled claim. Stable (it only touches refs), so the effects below can depend
     * on it without re-running.
     */
    const releaseUnsettledClaim = useCallback(() => {
        if (settleTimerRef.current) {
            clearTimeout(settleTimerRef.current)
            settleTimerRef.current = null
        }

        const claim = claimedRef.current
        if (!claim) return

        claimedRef.current = null
        releaseEmptyInboxDayCelebration(claim.userId, claim.dayKey)
    }, [])

    useLayoutEffect(() => {
        const previousAmount = previousAmountRef.current
        previousAmountRef.current = todayInboxAmount
        /**
         * AT-2506 — "the inbox emptied while I was looking at it", which is the moment this task is
         * about. Measured before every gate below, so a surface that may not celebrate still keeps
         * its count history and the next transition is measured from the right place.
         */
        const watchedTheClearing = didReachEmptyInbox(previousAmount, todayInboxAmount)

        if (!celebrationIsOnScreen) return
        // A run is already playing. A second one started on top of it would restart the headline
        // and the confetti from the first frame, which reads as a glitch rather than as a second
        // celebration — and the run on screen is already the acknowledgement of the work just done.
        if (claimedRef.current) return
        /**
         * AT-2506 — the once-per-day marker now answers only for an inbox that was ALREADY empty
         * when we arrived.
         *
         * "Always play the animation" and "do not replay it on every mount" are both real
         * requirements, and this is the line between them. Reaching inbox zero is an EVENT, so
         * every time it happens it is celebrated — clear it, let new tasks land, clear it again,
         * and each clearing gets its own run. Arriving at a board that is already empty is not an
         * event: a reload, a tab switch or a hop between My Day and All Projects must stay silent,
         * and the marker is what keeps them silent. The marker is still WRITTEN below on both
         * paths, so a clearing that has just been celebrated cannot be replayed by navigating away
         * and back.
         */
        if (!watchedTheClearing && hasCelebratedEmptyInboxDay(userId, todayKey)) return

        markEmptyInboxDayCelebrated(userId, todayKey)
        claimedRef.current = { userId, dayKey: todayKey }
        setCelebrationRunId(runId => runId + 1)

        settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = null
            claimedRef.current = null
        }, CELEBRATION_CLAIM_SETTLE_MS)
    }, [celebrationIsOnScreen, todayInboxAmount, todayKey, userId])

    /**
     * AT-2506 — the refund is its own effect, and that separation is load-bearing.
     *
     * It used to be the decision effect's cleanup, which was correct while the only dependencies
     * were the day and the enabled flag: the effect re-ran when the celebration appeared or
     * disappeared, and nothing else. `todayInboxAmount` broke that, because it moves for reasons
     * that have nothing to do with the run being on screen — so the cleanup fired mid-run, refunded
     * the day it had just claimed, and the effect body immediately re-claimed it and started a
     * SECOND run. `useProjectCompletedSweep` names the same trap in its `lineOnScreenRef` comment.
     *
     * Refunding is about the run LEAVING, so that is what these two express and nothing else: the
     * celebration stopping being on screen, and the surface going away entirely. A claim that has
     * already settled is not refundable either way, so an ordinary end-of-run is untouched.
     */
    useLayoutEffect(() => {
        if (celebrationIsOnScreen) return
        releaseUnsettledClaim()
    }, [celebrationIsOnScreen, releaseUnsettledClaim])

    useLayoutEffect(() => () => releaseUnsettledClaim(), [releaseUnsettledClaim])

    return celebrationRunId
}
