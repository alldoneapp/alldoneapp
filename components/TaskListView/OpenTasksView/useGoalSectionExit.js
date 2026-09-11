import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
 * ── AT-2521: THOSE TWO OUTCOMES ARE A SEQUENCE, NOT A FORK ───────────────────────────────────────
 *
 * The fork above is real, but it is not reached in one step, and reading it as one is what kept this
 * animation off the screen entirely. A goal leaves today's list for exactly one reason after a
 * completion: its `progress` reached 100, so `isNotCompleted` in `openTasks.js` stops admitting it.
 * That number lives on the GOAL document and arrives through the goals listener, while the task
 * leaving the bucket arrives through the tasks listener — and the goal write is CAUSED by the task
 * write. The task snapshot therefore lands first essentially every time, so the ordinary production
 * sequence is:
 *
 *   1. the section empties     → the goal is still active today, so it lands in `emptyGoals`
 *   2. the goal document lands → progress is 100, and now it is gone from the day
 *
 * Frame 1 is the "it is staying" case above and must still animate nothing, because a goal really
 * can sit there indefinitely. But the previous version also FORGOT the section at that point — only
 * sections holding tasks, and goals already exiting, were re-remembered — so by frame 2 there was no
 * record left to judge the departure against, and the goal popped exactly as it had before. Every
 * test passed, because they all modelled the departure as a single step.
 *
 * A goal seen in `emptyGoals` is therefore kept as a PENDING departure: its task ids and its goal
 * object are remembered so that a later real departure is still attributable to the completion,
 * while nothing is animated for as long as the row is on screen. `COMPLETION_MEMORY_MS` is what
 * stops that pending state from turning a departure hours later into an animation, and tasks
 * reappearing under the goal replace the record outright.
 *
 * ── AND IT IS HELD IN THE SHAPE IT WAS LAST RENDERED IN ──────────────────────────────────────────
 *
 * Which of the two rows is on screen at the moment of departure decides where the hold has to put
 * it back. A goal that left directly from a populated section is re-injected into the main list as
 * `[goalId, []]`; a goal that left from the empty-goals bucket is re-injected THERE, so that the
 * `EmptyGoal` node which is already mounted and already measured is the one that plays the exit.
 * Re-injecting the latter as a main section instead swaps it for a freshly mounted component whose
 * height has never been measured — `goalSectionExitMotion` then has nothing to collapse from, so the
 * block fades and still drops its full height in a single frame when the hold ends, which is the
 * jump this task is about.
 *
 * ── AND IT MUST BE A COMPLETION ──────────────────────────────────────────────────────────────────
 *
 * A goal also leaves today's list when its last task is postponed, dragged, deleted, reassigned or
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

/**
 * AT-2521 — keeps a goal that is playing its departure sortable, so the hold can actually put it
 * back where it was.
 *
 * `sortGoalTasksGorups` assigns every goal section a position, and `MainSection` treats a section
 * whose goal has none as ORPHANED: it folds any tasks into the general block and drops the tuple.
 * For a departing goal that means the row disappears instantly, hold or no hold — the exit is
 * computed, handed over, and never drawn.
 *
 * That is not hypothetical for exactly the goals this feature exists for. A goal only ever leaves
 * today's list because it reached 100%, and the BACKLOG branch of that sort is the one place where
 * a completed goal is refused a position (`progress !== 100 && ...`, mirroring the rule that took
 * the goal out of the day in the first place). So a goal sitting in the backlog milestone loses its
 * slot at the precise moment it starts leaving.
 *
 * The map handed to the sort is used for nothing else, so restoring the departing goal to "not
 * finished" for that one call keeps it in the slot it occupied a frame earlier, which is where its
 * exit has to play. The `DYNAMIC_PERCENT` sentinel is preserved rather than overwritten: it says
 * WHICH number counts, and only the number is being adjusted.
 *
 * @param {object} goalsById
 * @param {object} exitRunIdByGoalId
 * @returns {object} the same map when nothing is leaving — a fresh one would re-run the sort's
 *   consumers on every render.
 */
export const keepDepartingGoalsSortable = (goalsById, exitRunIdByGoalId) => {
    if (!goalsById || !exitRunIdByGoalId) return goalsById
    const departingIds = Object.keys(exitRunIdByGoalId).filter(goalId => {
        const goal = goalsById[goalId]
        return goal && (goal.progress === 100 || goal.dynamicProgress === 100)
    })
    if (departingIds.length === 0) return goalsById

    const patched = { ...goalsById }
    departingIds.forEach(goalId => {
        const goal = patched[goalId]
        patched[goalId] = {
            ...goal,
            progress: goal.progress === 100 ? 99 : goal.progress,
            dynamicProgress: goal.dynamicProgress === 100 ? 99 : goal.dynamicProgress,
        }
    })
    return patched
}

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
 * @returns {{mainTasksWithExits: Array, emptyGoalsWithExits: Array, exitRunIdByGoalId: object}}
 *   Each list is the very same array that came in whenever nothing is leaving from it — not a copy.
 *   `MainSection` feeds both to effect dependency lists, so a freshly built array on every render
 *   would re-run them (and their `setState`) in a loop; the same rule `taskPlacementHold` follows
 *   for the editing hold. A departing goal appears in exactly one of the two, whichever shape it
 *   was last rendered in.
 */
export default function useGoalSectionExit({ projectId, mainTasks, emptyGoals, enabled = false }) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const active = enabled && animated

    const [exits, setExits] = useState(EMPTY_EXITS)
    // goalId -> Map(taskId -> completedAt). Pruned lazily, only when a departure is being judged.
    const completionsRef = useRef(new Map())
    /**
     * goalId -> `{ taskIds, emptyGoal }`. The record of what "cleared" has to mean for this
     * particular goal: `taskIds` are the ids the section last rendered, and `emptyGoal` is the goal
     * object when the row has since moved to the empty-goals bucket — i.e. a departure that is
     * pending rather than finished (AT-2521). `emptyGoal` is null while the section still holds
     * tasks, and it is what decides where the hold puts the goal back.
     */
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
        lastSectionsRef.current.forEach((record, goalId) => {
            if (presentGoalIds.has(goalId) || exits[goalId] || timersRef.current.has(goalId)) return
            const byTask = completionsRef.current.get(goalId)
            if (!byTask) return
            const freshEnough = Date.now() - COMPLETION_MEMORY_MS
            const taskIds = record.taskIds
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
        // A section holding tasks always replaces whatever was remembered, which is also how a goal
        // that comes back drops any pending departure it had accumulated.
        if (taskIds.length > 0) seen.set(group[0], { taskIds, emptyGoal: null })
    })
    /**
     * AT-2521 — the pending state. A goal in the empty-goals bucket has NOT left, so it is not
     * judged here at all; its previous record is carried forward, now tagged with the row that is
     * on screen, so that the departure one snapshot later can still be attributed to the completion
     * and can be held in the right shape. A goal with no record is not given one: there would be no
     * tasks to require a completion of, which is exactly the goal that was empty all along.
     */
    liveEmptyGoals.forEach(goal => {
        if (!goal || !goal.id || seen.has(goal.id)) return
        const previous = lastSectionsRef.current.get(goal.id)
        if (previous) seen.set(goal.id, { taskIds: previous.taskIds, emptyGoal: goal })
    })
    // A goal that is neither on screen nor leaving is forgotten, so this cannot grow with the day.
    lastSectionsRef.current.forEach((record, goalId) => {
        if (!seen.has(goalId) && (exits[goalId] || timersRef.current.has(goalId))) seen.set(goalId, record)
    })
    lastSectionsRef.current = seen

    /**
     * AT-2521 — the held lists must keep their IDENTITY for as long as the hold lasts, not just
     * while nothing is leaving.
     *
     * `MainSection` feeds both of these into effect dependency lists, and one of those effects
     * (`tmpGoalsById` housekeeping) calls `setState` unconditionally with a freshly spread object.
     * So a list rebuilt on every render is not merely wasteful — the effect re-runs, sets state,
     * re-renders, rebuilds the list, and React tears the board down with "Maximum update depth
     * exceeded" after fifty passes.
     *
     * AT-2507 memoised only the "nothing is leaving" case, which left that loop live for exactly
     * the ~1.5s the exit was supposed to be playing — the one moment the feature exists for. The
     * memo below covers the hold too: `exits` only changes identity when a goal actually starts or
     * finishes leaving, and both incoming lists are redux slices, so a settled board recomputes
     * nothing and a departing one recomputes twice.
     *
     * `lastSectionsRef` is read inside deliberately and is not a dependency: while `exits` is
     * unchanged the record of every exiting goal is carried forward verbatim above, so re-reading
     * it could only ever produce the same answer.
     */
    return useMemo(() => {
        const exitingIds = Object.keys(exits)
        if (exitingIds.length === 0) {
            return { mainTasksWithExits: mainTasks, emptyGoalsWithExits: emptyGoals, exitRunIdByGoalId: EMPTY_EXITS }
        }

        // Put back exactly the row that was on screen — see the header for why the shape matters.
        const heldSections = []
        const heldEmptyGoals = []
        exitingIds.forEach(goalId => {
            const record = lastSectionsRef.current.get(goalId)
            if (record && record.emptyGoal) heldEmptyGoals.push(record.emptyGoal)
            // Re-injected as an empty section so the existing sort puts it back where it was.
            else heldSections.push([goalId, []])
        })

        const live = Array.isArray(mainTasks) ? mainTasks : []
        const liveEmpty = Array.isArray(emptyGoals) ? emptyGoals : []
        return {
            mainTasksWithExits: heldSections.length > 0 ? live.concat(heldSections) : mainTasks,
            emptyGoalsWithExits: heldEmptyGoals.length > 0 ? liveEmpty.concat(heldEmptyGoals) : emptyGoals,
            exitRunIdByGoalId: exits,
        }
    }, [mainTasks, emptyGoals, exits])
}
