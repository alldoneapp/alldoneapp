/**
 * AT-2436 — the Calendar section is ONE chronological list, and a goal is a heading inside it.
 *
 * The store hands this section its meetings pre-bucketed by goal (`[[goalId, tasks], …]`, one
 * entry per goal plus `NOT_PARENT_GOAL_INDEX` for the meetings with no goal), which is the shape
 * the goal-grouped MAIN list wants. AT-2377 rendered those buckets in that shape and only ordered
 * the buckets among themselves by their earliest meeting — so a bucket stayed CONTIGUOUS, and any
 * meeting the user had assigned a goal to dragged every other meeting of that goal to its position
 * (and, more visibly, pushed the goal's own meeting out of the clock order it belongs in). The
 * reported symptom: an 11:30 meeting carrying a goal rendered *below* the 17:15 one, at the bottom
 * of the section, because its goal card sorted after the whole general bucket.
 *
 * A meeting happens when it happens, so the clock is the only order this section may have. The
 * grouping is therefore rebuilt the other way round: sort ALL the meetings of the day into one
 * chronological list first, then cut that list into RUNS of consecutive meetings that share a goal.
 * A run is what gets a heading — a goal card for a goal run, the "General tasks" header for a run
 * with no goal — which is exactly the requested "General → goal → General" reading, and it falls
 * out of the ordering instead of being a second rule that can disagree with it.
 *
 * Consequences worth knowing:
 *
 *   - A goal whose meetings are separated in time by someone else's meeting is rendered TWICE, once
 *     per run. That is the point rather than a side effect: the alternative is lifting the later
 *     meeting up to the earlier card, which is the bug being fixed. `occurrence` numbers the runs of
 *     one goal so the caller can build a stable React key and a unique `refKey` for each card.
 *   - `goalIndex` stays the index of the goal's bucket in the ORIGINAL `calendarEvents` array, not
 *     the index of the run. It addresses the store bucket (the drag system resolves a drop target
 *     with it), and the buckets are untouched — only their rendering is re-cut.
 *   - Ordering is `compareTasksByCalendarPlacement`, the same AT-2351 rule My Day and the focus-task
 *     pick use, so no two views can disagree about which meeting is next. Ties fall back to bucket
 *     order and then arrival order, so the sort is stable and never swaps two meetings between
 *     renders.
 */

import { compareTasksByCalendarPlacement } from '../../../utils/CalendarTaskOrder'

/**
 * Flatten `[[goalId, tasks], …]` into chronologically-ordered runs of consecutive same-goal tasks.
 *
 * Returns `[{ goalId, taskList, goalIndex, occurrence, key }]`. Pure and allocation-only — safe to
 * call on every render.
 */
export const buildChronologicalCalendarRuns = calendarEvents => {
    if (!Array.isArray(calendarEvents)) return []

    const entries = []
    calendarEvents.forEach((goalTasksData, goalIndex) => {
        if (!Array.isArray(goalTasksData)) return
        const goalId = goalTasksData[0]
        const taskList = goalTasksData[1]
        if (!Array.isArray(taskList)) return

        taskList.forEach(task => {
            if (!task) return
            entries.push({ goalId, goalIndex, task, arrivalIndex: entries.length })
        })
    })

    entries.sort(
        (a, b) =>
            compareTasksByCalendarPlacement(a.task, b.task) ||
            a.goalIndex - b.goalIndex ||
            a.arrivalIndex - b.arrivalIndex
    )

    const runs = []
    // How many runs of each goal have been emitted so far. A Map, not an object literal: a goal id
    // is arbitrary user-facing data and `__proto__` as a key would corrupt a plain object.
    const runsPerGoalId = new Map()

    entries.forEach(({ goalId, goalIndex, task }) => {
        const currentRun = runs[runs.length - 1]
        if (currentRun && currentRun.goalId === goalId) {
            currentRun.taskList.push(task)
            return
        }

        const occurrence = runsPerGoalId.has(goalId) ? runsPerGoalId.get(goalId) + 1 : 0
        runsPerGoalId.set(goalId, occurrence)

        runs.push({
            goalId,
            goalIndex,
            occurrence,
            // Stable across renders while the goal keeps the same number of runs, so React does not
            // remount a goal card (and re-open its goal watcher) on every calendar snapshot.
            key: `${goalId}#${occurrence}`,
            taskList: [task],
        })
    })

    return runs
}
