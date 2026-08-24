import { useLayoutEffect, useState } from 'react'
import moment from 'moment'

import { EMPTY_INBOX_DATE_FORMAT } from './AchievementsHelper'
import { hasCelebratedEmptyInboxDay, markEmptyInboxDayCelebrated } from './emptyInboxCelebrationMarker'

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

    useLayoutEffect(() => {
        if (!enabled || !achievedToday) return
        if (hasCelebratedEmptyInboxDay(userId, todayKey)) return

        markEmptyInboxDayCelebrated(userId, todayKey)
        setCelebrationRunId(runId => runId + 1)
    }, [achievedToday, enabled, todayKey, userId])

    return celebrationRunId
}
