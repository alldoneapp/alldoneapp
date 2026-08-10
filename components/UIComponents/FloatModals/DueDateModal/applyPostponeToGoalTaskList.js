/**
 * AT-2160 — postponing a goal that is shown with its tasks.
 *
 * The old shape of this was a `for … of` loop with an `await` inside, and the goal's own reminder
 * written only after the loop finished. Every task write commits to Firestore and then waits for
 * the server to acknowledge it, so task N+1 did not even start until task N had made a full round
 * trip: a goal with five tasks needed five round trips before its section cleared, and the goal row
 * itself moved last of all.
 *
 * Nothing about that ordering was load-bearing. Each write is independent, and Firestore applies
 * every one of them to the local cache the moment it is issued — so starting them together means
 * the whole section moves in one frame instead of trickling out. The goal reminder goes first for
 * the same reason: it is the row the user swiped, and it should not be the last thing to react.
 *
 * A task that fails is reported and skipped; it must never stop the rest of the list from moving.
 */
export async function applyPostponeToGoalTaskList({ tasks, updateGoalReminderDate, applyToTask, onTaskError }) {
    if (updateGoalReminderDate) updateGoalReminderDate()

    if (!applyToTask || !tasks || tasks.length === 0) return []

    return Promise.all(
        tasks.map(task =>
            Promise.resolve()
                .then(() => applyToTask(task))
                .catch(error => {
                    if (onTaskError) onTaskError(task, error)
                    return null
                })
        )
    )
}
