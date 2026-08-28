import { useLayoutEffect, useRef, useState } from 'react'
import moment from 'moment'

import { EMPTY_INBOX_DATE_FORMAT } from './AchievementsHelper'
import {
    hasCelebratedEmptyInboxDay,
    markEmptyInboxDayCelebrated,
    releaseEmptyInboxDayCelebration,
} from './emptyInboxCelebrationMarker'

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
 * @param {string[]} emptyInboxDays Normalized `YYYY-MM-DD` achievement days.
 * @param {boolean} enabled Only the empty-inbox board celebrates. The Settings → Profile card
 *   renders the same overview and must neither animate nor CONSUME the once-per-day marker, or
 *   opening your profile would silently spend the celebration the board was going to show you.
 * @param {string} userId Scopes the marker; a second account on the same browser gets its own.
 * @returns {number} 0 while there is nothing to celebrate, then a stable non-zero run id.
 */
export default function useTodayEmptyInboxCelebration(emptyInboxDays, enabled, userId) {
    const todayKey = moment().format(EMPTY_INBOX_DATE_FORMAT)
    const achievedToday = emptyInboxDays.includes(todayKey)
    const [celebrationRunId, setCelebrationRunId] = useState(0)
    // AT-2445: holds the day this mount claimed and has not yet watched play out. It is cleared once
    // the run has been on screen for the settle window — at which point the day is spent for real —
    // and a teardown while it is still set hands the day back, so the next genuine view of the empty
    // inbox still gets its celebration.
    const claimedRef = useRef(null)

    useLayoutEffect(() => {
        if (!enabled || !achievedToday) return undefined
        if (claimedRef.current === todayKey) return undefined
        if (hasCelebratedEmptyInboxDay(userId, todayKey)) return undefined

        markEmptyInboxDayCelebrated(userId, todayKey)
        claimedRef.current = todayKey
        setCelebrationRunId(runId => runId + 1)

        const playedTimer = setTimeout(() => {
            claimedRef.current = null
        }, CELEBRATION_CLAIM_SETTLE_MS)

        return () => {
            clearTimeout(playedTimer)
            if (claimedRef.current !== todayKey) return
            claimedRef.current = null
            releaseEmptyInboxDayCelebration(userId, todayKey)
        }
    }, [achievedToday, enabled, todayKey, userId])

    return celebrationRunId
}
