import { MAX_UNDO_OPERATIONS } from '../../undo/undoActions'

/**
 * Captures the pre-transition state of the tasks a move is about to change, so the
 * transition can be undone.
 *
 * The capture is best-effort by contract (AT-2484). It is a one-shot read that runs BEFORE
 * the write, and until this module existed it was a hard dependency of the move: any failure
 * aborted the whole transition with only a console warning to show for it. That is the wrong
 * trade — a move the user asked for matters more than the ability to take it back — and the
 * failure it turned into a dead button is not rare. Production reports rules-evaluation
 * ERRORs in bursts (hundreds per active hour, next to zero real denials), each of which the
 * client receives as `permission-denied`, a code the Firestore SDK classifies as permanent
 * and never retries. The reported move (a task the user had created 90 seconds earlier, in a
 * project they own) failed twice in a row on exactly that read while the same client kept
 * writing successfully around it.
 *
 * So a read that fails through the regular client is retried ONCE through the authenticated
 * REST endpoint (`readFromServer`): it has no listener state, no local cache and evaluates the
 * same security rules, which is what makes it a genuinely independent second opinion rather
 * than the same wedged stream asked twice. If that fails too, the answer is `null` — the
 * caller proceeds with a transition that simply cannot be undone — and a single warning names
 * the reason.
 *
 * A document that does not exist is not a failure either. `subtaskIds` and `parentId` are
 * denormalized and can point at a task that is gone; there is nothing to restore for it, so
 * it is left out of the states instead of failing the capture (the old code threw
 * "A task changed before its undo state could be captured" for exactly that case). Note that
 * before the matching rules change a read of a missing task document was itself reported as
 * `permission-denied`, so this path only became reachable together with it.
 *
 * Both readers resolve to `{ exists, data }`; the compat snapshot and the REST helper are
 * adapted at the call site. Never throws.
 */
export const captureTaskUndoStates = async ({ projectId, taskIds, readFromClient, readFromServer, log }) => {
    const warn = typeof log === 'function' ? log : console.warn
    const uniqueTaskIds = Array.from(new Set((taskIds || []).filter(Boolean)))
    if (uniqueTaskIds.length === 0) return {}
    if (uniqueTaskIds.length > MAX_UNDO_OPERATIONS) {
        warn('[task undo] This task transition affects too many tasks to be undoable; continuing without undo', {
            projectId,
            taskCount: uniqueTaskIds.length,
        })
        return null
    }

    const readOne = async taskId => {
        const path = `items/${projectId}/tasks/${taskId}`
        let clientError
        try {
            return await readFromClient(path)
        } catch (error) {
            clientError = error
        }
        if (typeof readFromServer !== 'function') throw clientError
        try {
            const result = await readFromServer(path)
            warn(
                '[task undo] Captured the state before the task transition through the server after the client read failed',
                {
                    projectId,
                    taskId,
                    clientError: clientError?.code || clientError?.message,
                }
            )
            return result
        } catch (serverError) {
            serverError.clientError = clientError
            throw serverError
        }
    }

    const settled = await Promise.allSettled(uniqueTaskIds.map(readOne))
    const failed = settled.findIndex(result => result.status === 'rejected')
    if (failed >= 0) {
        const { reason } = settled[failed]
        warn('[task undo] Could not capture the state before the task transition; continuing without undo', {
            projectId,
            taskId: uniqueTaskIds[failed],
            error: reason?.message,
            code: reason?.code,
            clientError: reason?.clientError?.code || reason?.clientError?.message,
        })
        return null
    }

    return settled.reduce((states, result, index) => {
        const snapshot = result.value
        if (snapshot && snapshot.exists) states[uniqueTaskIds[index]] = snapshot.data
        return states
    }, {})
}
