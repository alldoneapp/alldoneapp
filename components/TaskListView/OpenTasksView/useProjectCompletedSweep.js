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
 *
 * This started at two animation frames (120ms), which was far too tight and is why the sweep was
 * effectively invisible in All Projects: the two snapshots this races are delivered by two
 * independent Firestore listeners AND arrive through different amounts of React work
 * (`thereAreNotTasksInFirstDay` is derived up through `OpenTasksByProjectHandler` and the parent's
 * state, `sidebarNumbers` through a store dispatch), so a skew of several hundred milliseconds is
 * ordinary rather than exceptional. Losing that race did not degrade the celebration, it deleted
 * it — the block unmounts, the project never renders a line again that day, and the run is gone.
 *
 * It is safe to be generous here because of WHO opens the probe: only a line that is BOTH leaving
 * AND fully eligible to celebrate (the logged user's own board, no task filters, motion enabled).
 * That is precisely the moment a project's today list empties in front of you. Every other reason a
 * project block disappears — a priority or VM filter, an assistant board, a project losing access —
 * never opens it and is not delayed by a single frame. And the celebrating case already holds the
 * line for `PROJECT_LINE_EXIT_HOLD_MS` (~2.9s since the sweep grew to four stages), so this cannot
 * make a cleared project outstay the sweep it is waiting for.
 */
export const PROJECT_SWEEP_PROBE_MS = 700

/**
 * How late a clearing this hook WATCHED may arrive and still be celebrated after the line has
 * already been dropped.
 *
 * The probe above is the prevention: it keeps the line on screen so the sweep plays without the row
 * ever moving. This is the cure for the tail — a count that lands after even that window. Taking it
 * means the line comes back for one sweep, so it is deliberately bounded: beyond this the moment has
 * passed and the run is declined, which costs nothing, because the reached-record is left UNSPENT
 * and the project's own board will still play it the next time it is opened.
 */
export const PROJECT_LATE_CLEARING_GRACE_MS = 2000

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
 * Did this project's line leave the board recently enough that bringing it back for one sweep still
 * reads as part of the same moment? A line that was never on screen answers false, which is what
 * keeps an All Projects block for a project cleared hours ago from materialising just to celebrate.
 */
const lineLeftRecently = (lineWasOnScreenRef, lineLeftAtRef) =>
    lineWasOnScreenRef.current && Date.now() - lineLeftAtRef.current <= PROJECT_LATE_CLEARING_GRACE_MS

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
    /**
     * Has this project's line been on screen at all during this mount, and when did it last leave?
     *
     * These exist for the failure this hook shipped with. `lineOnScreen` was treated as a
     * PRECONDITION for celebrating, but in All Projects it is also a CONSEQUENCE of the celebration
     * being declined: the line is dropped when the probe gives up, and from then on the same hook —
     * which is still mounted, because it lives in `OpenTasksByProject` rather than in the block —
     * would refuse the very clearing it was waiting for, forever. "Not on screen" has to be split
     * into its two meanings: a project that never had a line this session (an All Projects block for
     * a project cleared earlier — correctly skipped, so its own board can still celebrate it), and a
     * line that has JUST left because of the clearing we are being told about (which must still
     * play).
     */
    const lineWasOnScreenRef = useRef(lineOnScreen)
    const lineLeftAtRef = useRef(0)
    useLayoutEffect(() => {
        if (lineOnScreen) lineWasOnScreenRef.current = true
        else if (lineOnScreenRef.current) lineLeftAtRef.current = Date.now()
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
        const watchedTheClearing = didProjectReachEmptyInbox(previousCount, todayCount)
        if (userId && projectId && watchedTheClearing) {
            markProjectEmptyInboxDayReached(userId, projectId, todayKey)
        }

        if (!enabled || !userId || !projectId) return undefined
        /**
         * Claiming the day is what makes the celebration once-per-day, so it may only ever happen
         * for a run that can actually be SEEN. Under reduced motion (and under jest) the sweep
         * renders nothing at all by design — so claiming here would silently spend the day on a
         * celebration nobody was shown, which is exactly the failure AT-2445 names. Standing down
         * before the claim leaves the record intact instead.
         *
         * Worth knowing: react-native-web's `isReduceMotionEnabled()` resolves to `true` when
         * `window.matchMedia` is unavailable, so this branch is reachable by an environment that
         * merely cannot answer the question, not only by a user who asked for less motion.
         */
        if (!animated) return undefined
        // Nothing to sweep. In All Projects this is the ordinary case for a project cleared earlier
        // today and arrived at later: its block is not rendered at all, so the day stays unspent and
        // the project's own board can still celebrate it.
        //
        // A clearing this hook WATCHED is the exception, and it is the whole point of the two refs
        // above: a project whose count we saw go from "has tasks" to "clear" necessarily had a line
        // on screen a moment ago (a project with tasks due today renders its block on both boards),
        // so a snapshot that arrives just after the board dropped the row is late, not ineligible.
        if (!lineOnScreenRef.current && !(watchedTheClearing && lineLeftRecently(lineWasOnScreenRef, lineLeftAtRef)))
            return undefined
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
        // place, and a hold nobody consumes is free. Unconditional now that `!animated` has already
        // returned above: when the line had just left, this is also what brings it back for the run.
        setHolding(true)

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
