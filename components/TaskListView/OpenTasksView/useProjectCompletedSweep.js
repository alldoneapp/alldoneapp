import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import moment from 'moment'

import { EMPTY_INBOX_DATE_FORMAT } from '../../SettingsView/Profile/Achievements/AchievementsHelper'
import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'
import { PROJECT_LINE_EXIT_HOLD_MS } from './projectCompletedSweepMotion'
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
 * AT-2492 (second pass) — decides whether clearing this project's today list should be celebrated,
 * and keeps the project line on the board long enough for the sweep to play.
 *
 * It replaces `useProjectEmptyInboxCelebration`, which lived in `OpenTasksByDate` (today's date
 * section). That home stopped working the moment the celebration moved from the Anna picture to the
 * project line, for a blunt reason: in All Projects a cleared project renders NOTHING — the whole
 * block, header row included, is dropped by `hideProjectData` — so the date section is unmounted at
 * exactly the moment we want to animate. This hook therefore lives in `OpenTasksByProject`, which is
 * the one component that stays mounted for every project whether or not that project has anything
 * to show.
 *
 * ── THE EXIT HOLD ────────────────────────────────────────────────────────────────────────────────
 *
 * "Celebrate a project you just cleared, in All Projects" and "drop a cleared project from the
 * board" are in direct conflict: the board is trying to remove the exact row the celebration is
 * about. The resolution Karsten picked is the same grammar AT-2404 already uses for a completing
 * task row — sweep, THEN leave — so this hook returns `holdProjectLine`, and the board keeps the
 * line for one sweep before dropping it. The settled layout is unchanged; only the moment of
 * departure moves, by under a second.
 *
 * The hold is bounded three ways, because a project stuck on a board it should have left is a
 * visible bug where a missed sweep is merely a missed flourish: it always expires on a timer, it is
 * never taken when there will be no visible sweep (reduced motion, jest), and it is never taken for
 * a line leaving for some other reason.
 *
 * ── THE PROBE, AND WHY IT EXISTS ─────────────────────────────────────────────────────────────────
 *
 * Two different store slices say "this project's today list is empty", and they are written by two
 * different Firestore listeners: `sidebarNumbers` (the unfiltered today+overdue count, which is what
 * the marker records are keyed on) and `thereAreNotTasksInFirstDay` (which is what actually drives
 * `hideProjectData`). They land in whatever order the network gives them. If the hide lands first,
 * the line is gone before the count has told us the project was cleared, and the sweep plays into
 * nothing.
 *
 * So a line that is about to leave gets a PROVISIONAL hold of `PROJECT_SWEEP_PROBE_MS` while we find
 * out. That window is deliberately tiny and, importantly, is only ever opened for a line whose
 * project is otherwise eligible to celebrate — so applying a priority filter, which hides projects
 * through the same code path, is not delayed at all.
 *
 * The probe is armed by a render-phase state update (React's documented "adjust state when a prop
 * changes" pattern) rather than from an effect. That is not a micro-optimisation: an effect runs
 * AFTER the commit that already removed the block from the DOM, so the user would see the project
 * vanish and reappear. Adjusting during render means the block is never unmounted at all.
 */

/**
 * How long a line that is leaving is held while we wait to hear whether its project was cleared.
 * Two animation frames' worth of slack, so a snapshot arriving in the next batch is still caught.
 * Long enough to absorb the ordering, short enough to be imperceptible when nothing comes of it.
 */
export const PROJECT_SWEEP_PROBE_MS = 120

/**
 * How long a claimed day stays refundable. Same rule and reasoning as `CELEBRATION_CLAIM_SETTLE_MS`
 * in `useTodayEmptyInboxCelebration`: the marker is claimed before the first frame, so a mount torn
 * down mid-run would otherwise have spent the day without showing anything.
 *
 * Derived from the hold rather than hand-tuned, so it can never end up shorter than the run it is
 * covering — the failure that would make a day "already celebrated" while nothing was seen.
 */
export const PROJECT_CELEBRATION_CLAIM_SETTLE_MS = PROJECT_LINE_EXIT_HOLD_MS + 200

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * @param {string} options.projectId
 * @param {string} options.userId Scopes the marker; a second account on the same browser gets its own.
 * @param {boolean} options.enabled May this board spend the day? See the gate list at the call site
 *   in `OpenTasksByProject`. The transition is still RECORDED when this is false, because the
 *   project was cleared whether or not this surface may celebrate it.
 * @param {boolean} options.lineWouldLeave Is the board about to drop this project's block? True only
 *   in All Projects; the selected-project board always keeps its header.
 * @returns {{celebrationRunId: number, holdProjectLine: boolean}}
 */
export default function useProjectCompletedSweep({ projectId, userId, enabled, lineWouldLeave }) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const todayCount = useSelector(state => state.sidebarNumbers?.[projectId]?.[userId])

    const [celebrationRunId, setCelebrationRunId] = useState(0)
    const [probing, setProbing] = useState(false)
    const [holding, setHolding] = useState(false)
    const [previousLineWouldLeave, setPreviousLineWouldLeave] = useState(lineWouldLeave)
    const previousCountRef = useRef(undefined)
    const claimedRef = useRef(null)

    const todayKey = moment().format(EMPTY_INBOX_DATE_FORMAT)

    // Render-phase adjustment, see the header. Guarded by the comparison, so it cannot loop.
    if (lineWouldLeave !== previousLineWouldLeave) {
        setPreviousLineWouldLeave(lineWouldLeave)
        // Only a line that is BOTH leaving and eligible opens a probe, so every other reason a
        // project block disappears — a filter, a project losing access — is untouched and instant.
        setProbing(lineWouldLeave && enabled && animated)
    }

    const lineOnScreen = !lineWouldLeave || probing || holding

    /**
     * `lineOnScreen` is read by the decision below but deliberately kept OUT of its dependency
     * array, so it is threaded through a ref that is refreshed on every commit.
     *
     * The reason is the refund. The decision effect's cleanup hands the day back if it runs while
     * the claim is still fresh — that is what stops a mount torn down mid-run from silently spending
     * the day. But an effect re-run also fires its cleanup, and `lineOnScreen` flips as a DIRECT
     * CONSEQUENCE of claiming (the claim takes the hold): listing it would refund the day one tick
     * after claiming it, then immediately re-claim and restart the sweep. Nothing needs it as a
     * trigger anyway — the moments worth re-deciding on are the count moving and the gates opening,
     * both of which are listed.
     *
     * Declared before the decision effect so it has already run when the decision reads it; effects
     * within a component run in declaration order.
     */
    const lineOnScreenRef = useRef(lineOnScreen)
    useLayoutEffect(() => {
        lineOnScreenRef.current = lineOnScreen
    })

    /**
     * `useLayoutEffect`, not `useEffect`, for the AT-2418 reason: the line is already on screen and
     * painted by the time this decides to sweep it, so a passive effect would show the settled row
     * and then jump it back to the first frame of the sweep.
     */
    useLayoutEffect(() => {
        const previousCount = previousCountRef.current
        previousCountRef.current = todayCount

        // Recorded regardless of `enabled`: the record is what lets a later visit to the board still
        // celebrate it. Idempotent, so the app-wide `useReachProjectEmptyInbox` writing the same
        // thing on the same tick costs nothing. This hook keeps its own detection because effects
        // run child-before-parent — the app-wide detector mounted above has NOT run yet on the tick
        // the count reaches zero.
        if (userId && projectId && didProjectReachEmptyInbox(previousCount, todayCount)) {
            markProjectEmptyInboxDayReached(userId, projectId, todayKey)
        }

        if (!enabled || !userId || !projectId) return undefined
        // Nothing to sweep. In All Projects this is the ordinary case for a project cleared earlier
        // today and arrived at later: its block is not rendered at all, so the day stays unspent and
        // the project's own board can still celebrate it.
        if (!lineOnScreenRef.current) return undefined
        if (!projectTodayListLooksClear(todayCount)) return undefined
        if (claimedRef.current === todayKey) return undefined
        // Nothing was cleared today, so there is nothing to congratulate. This is what keeps a
        // project that simply has no tasks — most of a 78-project account, most days — from sweeping
        // every time it is looked at.
        if (!hasReachedProjectEmptyInboxDay(userId, projectId, todayKey)) return undefined
        if (hasCelebratedProjectEmptyInboxDay(userId, projectId, todayKey)) return undefined

        markProjectEmptyInboxDayCelebrated(userId, projectId, todayKey)
        claimedRef.current = todayKey
        setCelebrationRunId(runId => runId + 1)
        // Taken even on the selected-project board, where no line is leaving and it changes nothing.
        // Deciding here rather than at the call site keeps "how long does the sweep need" in one
        // place, and a hold nobody consumes is free.
        if (animated) setHolding(true)

        const playedTimer = setTimeout(() => {
            claimedRef.current = null
        }, PROJECT_CELEBRATION_CLAIM_SETTLE_MS)

        return () => {
            clearTimeout(playedTimer)
            if (claimedRef.current !== todayKey) return
            claimedRef.current = null
            releaseProjectEmptyInboxDayCelebration(userId, projectId, todayKey)
        }
    }, [animated, enabled, projectId, todayCount, todayKey, userId])

    // Both holds expire on their own. Neither can outlive its timer, so the worst case for any bug
    // above is a project line that leaves the board under a second late.
    useEffect(() => {
        if (!probing) return undefined
        const probeTimer = setTimeout(() => setProbing(false), PROJECT_SWEEP_PROBE_MS)
        return () => clearTimeout(probeTimer)
    }, [probing])

    useEffect(() => {
        if (!holding) return undefined
        const holdTimer = setTimeout(() => setHolding(false), PROJECT_LINE_EXIT_HOLD_MS)
        return () => clearTimeout(holdTimer)
    }, [holding])

    return { celebrationRunId, holdProjectLine: probing || holding }
}
