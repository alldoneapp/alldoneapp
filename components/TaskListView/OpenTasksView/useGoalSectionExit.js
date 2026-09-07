import { useCallback, useEffect, useRef, useState } from 'react'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'
import { subscribeToGoalTaskCompletions } from './goalCompletionSignal'
import { GOAL_SECTION_EXIT_TOTAL_MS } from './goalSectionExitMotion'

/**
 * AT-2507 — decides which goal sections are LEAVING today's list because their work is finished,
 * and keeps them on the board long enough to leave gracefully instead of popping.
 *
 * ── "ACTUALLY LEAVES" IS A NARROWER EVENT THAN "WAS CLEARED" ─────────────────────────────────────
 *
 * The obvious reading — animate whenever a goal's last task of the day is completed — is wrong here,
 * and the reason is a fork in `generateOpenTasksArray` that is invisible from the UI. When a goal's
 * task bucket empties, `openTasks.js` drops its `[goalId, tasks]` tuple, and what happens next
 * depends on something else entirely: whether the goal is still an ACTIVE GOAL for today (its own
 * reminder date is today or overdue and it is not yet 100%).
 *
 *   • if it is, the goal moves to `EMPTY_SECTION_INDEX` and `MainSection` renders an `EmptyGoal`
 *     under the same key — the row STAYS, with its add-task line, ready for more work. Nothing is
 *     leaving, and an exit animation there would fade out a row that is about to be redrawn.
 *   • if it is not, the goal is gone from the day entirely. THAT is the pop this fixes.
 *
 * So the test is not "did the bucket empty" but "is this goal absent from BOTH lists now" — which
 * is what `presentGoalIds` below computes. It also means most cleared goals correctly play nothing
 * at all, which is the deliberate answer to "only when the goal row actually leaves today's list".
 *
 * ── AND IT MUST BE A COMPLETION ──────────────────────────────────────────────────────────────────
 *
 * A goal also leaves today's list when its last task is dragged to tomorrow, deleted, reassigned or
 * re-goaled, and when the goal itself is postponed. None of those is finished work. Watching the
 * list alone cannot tell them apart — the AT-2492 lesson that "the list is empty" is not "the work
 * was done" — so departures are cross-checked against `goalCompletionSignal`, which only ever
 * carries genuine completions of list-leaving rows. Every other way of leaving keeps today's
 * behaviour exactly, including its instant removal.
 *
 * ── THE HOLD, AND WHY IT IS UNAVOIDABLE ──────────────────────────────────────────────────────────
 *
 * "Animate a section out" and "the section no longer exists" are in direct conflict: by the time we
 * know the goal has left, `MainSection` has already stopped emitting it. AT-2492 hit the same wall
 * one scope up and resolved it the same way — the board keeps rendering the block for one run and
 * then drops it. Here the held section is re-injected into the main-tasks list as `[goalId, []]`,
 * so the existing sort places it exactly where it was and no other code needs to know.
 *
 * An empty task list is the right content for it, and not merely convenient: those task rows have
 * already collapsed to zero height under AT-2404's own exit, and re-rendering the completed task
 * would bring a finished row back onto the screen for the length of the hold.
 *
 * The decision is made DURING RENDER (React's documented "adjust state when a prop changes" shape,
 * guarded so it cannot loop) rather than from an effect, for the reason AT-2492 records: an effect
 * runs after the commit that already removed the block, so the user would see the section vanish
 * and then reappear to animate. Adjusting during render means it is never unmounted at all.
 *
 * The hold is bounded three ways, because a goal stranded on a board it should have left is a real
 * bug where a missed animation is only a missed nicety: it always expires on a timer, it is never
 * taken when there would be nothing to see (reduced motion, jest), and it is never taken for a
 * section leaving for any other reason. It delays no Firestore write — the write that completed the
 * task happened over a second earlier, which is precisely why this section is still on screen to be
 * held.
 */

/** A little longer than the run, so the last frame cannot be cut off by the hold expiring first. */
export const GOAL_SECTION_HOLD_MS = GOAL_SECTION_EXIT_TOTAL_MS + 120

/**
 * How long a completed task id is remembered as a reason for its goal to leave.
 *
 * It has to outlive the gap between the tick and the snapshot — AT-2404 holds the write for
 * `COMPLETION_HOLD_MS` (1070ms) and the round trip follows it — and it must not be so long that a
 * task completed at breakfast still counts as the reason a goal left at lunchtime. Ten seconds is
 * two orders of magnitude clear of the first and three of the second.
 */
export const COMPLETION_MEMORY_MS = 10000

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

const EMPTY_EXITS = {}

const idsOfSection = tasks =>
    Array.isArray(tasks) ? tasks.map(task => (task && task.id ? task.id : null)).filter(Boolean) : []

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {Array} options.mainTasks The live `[goalId, tasks]` tuples for this date section.
 * @param {Array} options.emptyGoals The goals with nothing under them today — a goal here has NOT
 *   left the list, it has only lost its tasks.
 * @param {boolean} options.enabled May this list animate a departure? See the gate list at the call
 *   site in `MainSection`.
 * @returns {{mainTasksWithExits: Array, exitRunIdByGoalId: object}}
 *   `mainTasksWithExits` is the very same array that came in whenever nothing is leaving — not a
 *   copy of it. `MainSection` feeds this list to effect dependency lists, so a freshly built array
 *   on every render would re-run them (and their `setState`) in a loop; the same rule
 *   `taskPlacementHold` follows for the editing hold.
 */
export default function useGoalSectionExit({ projectId, mainTasks, emptyGoals, enabled = false }) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const active = enabled && animated

    const [exits, setExits] = useState(EMPTY_EXITS)
    // goalId -> Map(taskId -> completedAt). Pruned lazily, only when a departure is being judged.
    const completionsRef = useRef(new Map())
    // goalId -> the task ids that section last rendered. The record of what "cleared" has to mean
    // for this particular goal.
    const lastSectionsRef = useRef(new Map())
    const runIdRef = useRef(0)
    const timersRef = useRef(new Map())

    useEffect(() => {
        const timers = timersRef.current
        return () => {
            timers.forEach(clearTimeout)
            timers.clear()
        }
    }, [])

    useEffect(() => {
        if (!active) return undefined
        return subscribeToGoalTaskCompletions(event => {
            if (event.projectId !== projectId) return
            let byTask = completionsRef.current.get(event.goalId)
            if (!byTask) {
                byTask = new Map()
                completionsRef.current.set(event.goalId, byTask)
            }
            byTask.set(event.taskId, Date.now())
        })
    }, [active, projectId])

    const endExit = useCallback(goalId => {
        timersRef.current.delete(goalId)
        completionsRef.current.delete(goalId)
        setExits(current => {
            if (!current[goalId]) return current
            const next = { ...current }
            delete next[goalId]
            return Object.keys(next).length === 0 ? EMPTY_EXITS : next
        })
    }, [])

    const liveMainTasks = Array.isArray(mainTasks) ? mainTasks : []
    const liveEmptyGoals = Array.isArray(emptyGoals) ? emptyGoals : []

    /**
     * Everything the day still shows for this goal, in either shape. A goal that merely lost its
     * tasks is in `emptyGoals` and is therefore still present — see the header for why that case
     * must animate nothing.
     */
    const presentGoalIds = new Set()
    liveMainTasks.forEach(group => {
        if (Array.isArray(group) && group[0]) presentGoalIds.add(group[0])
    })
    liveEmptyGoals.forEach(goal => {
        if (goal && goal.id) presentGoalIds.add(goal.id)
    })

    const departing = []
    if (active) {
        lastSectionsRef.current.forEach((taskIds, goalId) => {
            if (presentGoalIds.has(goalId) || exits[goalId] || timersRef.current.has(goalId)) return
            const byTask = completionsRef.current.get(goalId)
            if (!byTask) return
            const freshEnough = Date.now() - COMPLETION_MEMORY_MS
            // EVERY task the section last held has to have been completed. One of them merely moved
            // or deleted means the goal did not leave because its work was finished.
            const clearedByCompletion =
                taskIds.length > 0 && taskIds.every(taskId => (byTask.get(taskId) || 0) >= freshEnough)
            if (clearedByCompletion) departing.push(goalId)
        })
    }

    // Render-phase adjustment, see the header. Guarded by the checks above, so it cannot loop: a
    // goal that has an exit is skipped, and one that is departing is given a timer in the same pass.
    if (departing.length > 0) {
        const next = { ...exits }
        departing.forEach(goalId => {
            runIdRef.current += 1
            next[goalId] = runIdRef.current
            timersRef.current.set(
                goalId,
                setTimeout(() => endExit(goalId), GOAL_SECTION_HOLD_MS)
            )
        })
        setExits(next)
    }

    /**
     * Recorded from the LIVE list, never from the injected one: a held section carries an empty task
     * list, and letting that overwrite the record would erase the very ids the departure was judged
     * against. Sections with no tasks are not recorded either, for the same reason — there would be
     * nothing to require a completion of.
     */
    const seen = new Map()
    liveMainTasks.forEach(group => {
        if (!Array.isArray(group) || !group[0]) return
        const taskIds = idsOfSection(group[1])
        if (taskIds.length > 0) seen.set(group[0], taskIds)
    })
    // A goal that is neither on screen nor leaving is forgotten, so this cannot grow with the day.
    lastSectionsRef.current.forEach((taskIds, goalId) => {
        if (!seen.has(goalId) && (exits[goalId] || timersRef.current.has(goalId))) seen.set(goalId, taskIds)
    })
    lastSectionsRef.current = seen

    const exitingIds = Object.keys(exits)
    if (exitingIds.length === 0) return { mainTasksWithExits: mainTasks, exitRunIdByGoalId: EMPTY_EXITS }

    // Re-injected as an empty section so the existing sort puts it back where it was.
    const mainTasksWithExits = liveMainTasks.concat(exitingIds.map(goalId => [goalId, []]))
    return { mainTasksWithExits, exitRunIdByGoalId: exits }
}
