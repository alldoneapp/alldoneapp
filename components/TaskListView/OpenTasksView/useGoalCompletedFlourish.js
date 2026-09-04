import { useCallback, useEffect, useRef, useState } from 'react'

import { subscribeToGoalTaskCompletions } from './goalCompletionSignal'

/**
 * AT-2507 — decides whether a goal section has just had its LAST task of the day completed, and
 * hands its goal row a run id to celebrate with.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
 *
 * A goal section owns exactly one list — the `[goalId, tasks]` tuple `MainSection` maps over — and
 * this fires when every task in that list is in flight towards "done". "In flight" rather than
 * "gone" is the whole timing trick: AT-2404 holds a completing row's Firestore write for
 * `COMPLETION_HOLD_MS` (1070ms) while the row collapses, so at the moment of the last tick this
 * component is still mounted, still has its full task list, and has a comfortable window to play a
 * celebration in before the snapshot arrives and takes the section away. That is why nothing here
 * needs AT-2492's probe, hold or late-clearing grace: the goal line is not racing its own removal.
 *
 * Tasks are matched against the section's OWN list, which is what keeps this correctly scoped when
 * the same goal renders more than once on a board (the main list and the observed/mention/suggested
 * lists each get their own `ParentGoalSection`). Completing every task of goal G in the main list
 * celebrates that section and leaves the others alone, because their task ids are not in the set.
 *
 * ── WHY IT CANNOT FIRE FOR WORK THAT WAS NOT DONE ────────────────────────────────────────────────
 *
 * Every gate that matters is upstream, in `goalCompletionSignal.js`: only a genuine completion of a
 * list-leaving task belonging to a goal is ever published, so a task dragged to tomorrow, deleted,
 * reassigned, re-goaled, or handed to the next workflow reviewer produces no event at all and this
 * hook never hears about it. The section still empties in those cases and the goal still leaves the
 * day exactly as it does today — silently, which is right, because nothing was finished.
 *
 * ── WHY THE SET IS RESET AFTER A RUN ─────────────────────────────────────────────────────────────
 *
 * `completingIds` accumulates across the day so that finishing a goal's three tasks over a morning
 * still lands on "all of them", and it is only ever cleared after a run has fired — by which time
 * every id in it names a task that has left the list. Clearing it (with the fired latch) after
 * `RESET_AFTER_RUN_MS` is what makes the goal celebratable AGAIN: a goal you clear, refill and clear
 * a second time gets a second flourish, matching the direction AT-2506 took one and two scopes up
 * ("a clearing is an event, not a day"). It is also what makes an undo-then-redo behave, since the
 * task's id is no longer remembered as already completing.
 */

/**
 * How long after a run the section forgets what it saw. Comfortably longer than any celebration
 * (the longest is well under a second) and than the 1070ms write hold that precedes the snapshot,
 * so the tasks it is forgetting have demonstrably left the list; short enough that a goal refilled
 * and re-cleared a moment later still celebrates.
 */
export const RESET_AFTER_RUN_MS = 3000

const idsOf = taskList =>
    Array.isArray(taskList) ? taskList.map(task => (task && task.id ? task.id : null)).filter(Boolean) : []

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {string} options.goalId
 * @param {Array} options.taskList The section's own tasks — the second element of its
 *   `[goalId, tasks]` tuple. Read through a ref, so a list that changes identity on every snapshot
 *   never re-subscribes.
 * @param {boolean} options.enabled May this section celebrate? See the gate list at the call site
 *   in `MainSection`; a section that may not celebrate simply never subscribes, so it costs a
 *   mounted goal on a filtered or foreign board nothing at all.
 * @returns {number} 0 until the goal's last task of the day is completed, then a run id that
 *   increments once per clearing.
 */
export default function useGoalCompletedFlourish({ projectId, goalId, taskList, enabled = false }) {
    const [completedRunId, setCompletedRunId] = useState(0)
    const completingIdsRef = useRef(new Set())
    const firedRef = useRef(false)
    const resetTimerRef = useRef(null)

    // Mirrored rather than closed over, so the subscription below depends only on the identity of
    // the goal it belongs to. `filteredOpenTasksStore` hands `MainSection` a fresh array on every
    // snapshot in the project, and re-subscribing on each of those would drop events that land
    // between the teardown and the re-attach.
    const taskListRef = useRef(taskList)
    taskListRef.current = taskList

    const clearResetTimer = useCallback(() => {
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
    }, [])

    useEffect(() => clearResetTimer, [clearResetTimer])

    useEffect(() => {
        if (!enabled || !projectId || !goalId) return undefined

        return subscribeToGoalTaskCompletions(event => {
            if (event.projectId !== projectId || event.goalId !== goalId) return

            const tasks = taskListRef.current
            const taskIds = idsOf(tasks)
            // An empty section has nothing to finish. Reachable while a snapshot is in flight, and
            // firing on it would celebrate a goal row that is showing no work at all.
            if (taskIds.length === 0) return
            // Not one of mine — another section of the same goal, on the same board.
            if (!taskIds.includes(event.taskId)) return

            completingIdsRef.current.add(event.taskId)
            if (firedRef.current) return
            if (!taskIds.every(taskId => completingIdsRef.current.has(taskId))) return

            firedRef.current = true
            setCompletedRunId(runId => runId + 1)
            clearResetTimer()
            resetTimerRef.current = setTimeout(() => {
                resetTimerRef.current = null
                completingIdsRef.current.clear()
                firedRef.current = false
            }, RESET_AFTER_RUN_MS)
        })
    }, [enabled, projectId, goalId, clearResetTimer])

    return completedRunId
}
