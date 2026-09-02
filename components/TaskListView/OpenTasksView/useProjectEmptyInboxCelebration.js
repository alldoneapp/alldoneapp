import { useLayoutEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import moment from 'moment'

import { EMPTY_INBOX_DATE_FORMAT } from '../../SettingsView/Profile/Achievements/AchievementsHelper'
import {
    didProjectReachEmptyInbox,
    hasCelebratedProjectEmptyInboxDay,
    hasReachedProjectEmptyInboxDay,
    markProjectEmptyInboxDayCelebrated,
    markProjectEmptyInboxDayReached,
    projectTodayListLooksClear,
    releaseProjectEmptyInboxDayCelebration,
} from './projectEmptyInboxCelebrationMarker'

/**
 * How long a claimed day stays refundable. Same rule and same reasoning as
 * `CELEBRATION_CLAIM_SETTLE_MS` in `useTodayEmptyInboxCelebration`: the marker is claimed before the
 * first frame, so a mount torn down mid-run would otherwise have spent the day without showing
 * anything. Sized against this celebration's ~1.5s rather than the all-projects ~3s.
 *
 * A local constant rather than an import of the motion's duration — this hook decides WHETHER to
 * celebrate and is kept ignorant of the animation — but it must never be shorter than the run, and
 * `useProjectEmptyInboxCelebration.test.js` pins that relationship from this side.
 */
export const PROJECT_CELEBRATION_CLAIM_SETTLE_MS = 1700

/**
 * AT-2492 — decides WHETHER clearing this project's today list should be celebrated, and returns a
 * run id the motion hook keys on. It knows nothing about the animation itself.
 *
 * It must live in a component that stays mounted whether or not the list is empty (today's
 * `OpenTasksByDate` section), NOT in the empty-state block: the block mounts only once the list is
 * already clear, so a hook inside it could never observe the transition that earns the celebration.
 *
 * Two independent paths reach a celebration, and the redundancy is deliberate — it is what removes
 * an ordering race that would otherwise make this flaky:
 *
 *   • you clear the last task WHILE looking at the project. This hook is subscribed to the same
 *     per-project count and sees `>0 → 0` itself, so it does not depend on the app-wide detector
 *     having run first. That matters because effects run child-before-parent, so the detector
 *     mounted above this one would write its record only AFTER this effect had already looked.
 *   • you clear it somewhere else (My Day, All Projects) and arrive later. `useReachProjectEmptyInbox`
 *     recorded the transition when it happened, and this hook reads that record on mount.
 *
 * `useLayoutEffect`, not `useEffect`, for the AT-2418 reason: the empty block is already on screen
 * and painted by the time this decides to celebrate it, so a passive effect would show the settled
 * picture and then jump it back to the first frame of its own entrance.
 *
 * @param {string} projectId
 * @param {string} userId Scopes the marker; a second account on the same browser gets its own.
 * @param {boolean} enabled The surface may spend the day. False on every board that is not the
 *   selected project's own today section, while task filters are active, and while the empty block
 *   is not actually on screen — see the call site in `OpenTasksByDate`. The transition is still
 *   recorded when this is false, because the moment happened whether or not we may celebrate it.
 * @returns {number} 0 while there is nothing to celebrate, then a stable non-zero run id.
 */
export default function useProjectEmptyInboxCelebration(projectId, userId, enabled) {
    const todayCount = useSelector(state => state.sidebarNumbers?.[projectId]?.[userId])
    const [celebrationRunId, setCelebrationRunId] = useState(0)
    const previousCountRef = useRef(undefined)
    const claimedRef = useRef(null)

    const todayKey = moment().format(EMPTY_INBOX_DATE_FORMAT)

    useLayoutEffect(() => {
        const previousCount = previousCountRef.current
        previousCountRef.current = todayCount

        // Recorded regardless of `enabled`: the project WAS cleared, and the record is what lets a
        // later visit to the board still celebrate it. Idempotent, so the app-wide detector writing
        // the same thing on the same tick costs nothing.
        if (userId && projectId && didProjectReachEmptyInbox(previousCount, todayCount)) {
            markProjectEmptyInboxDayReached(userId, projectId, todayKey)
        }

        if (!enabled || !userId || !projectId) return undefined
        if (!projectTodayListLooksClear(todayCount)) return undefined
        if (claimedRef.current === todayKey) return undefined
        // Nothing was cleared today, so there is nothing to congratulate. This is what keeps a
        // project that simply has no tasks — most of a 78-project account, most days — from
        // throwing confetti every time it is opened.
        if (!hasReachedProjectEmptyInboxDay(userId, projectId, todayKey)) return undefined
        if (hasCelebratedProjectEmptyInboxDay(userId, projectId, todayKey)) return undefined

        markProjectEmptyInboxDayCelebrated(userId, projectId, todayKey)
        claimedRef.current = todayKey
        setCelebrationRunId(runId => runId + 1)

        const playedTimer = setTimeout(() => {
            claimedRef.current = null
        }, PROJECT_CELEBRATION_CLAIM_SETTLE_MS)

        return () => {
            clearTimeout(playedTimer)
            if (claimedRef.current !== todayKey) return
            claimedRef.current = null
            releaseProjectEmptyInboxDayCelebration(userId, projectId, todayKey)
        }
    }, [enabled, projectId, todayCount, todayKey, userId])

    return celebrationRunId
}
