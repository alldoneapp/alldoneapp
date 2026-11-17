import { pickDifferentFocusTask } from '../../utils/backends/Tasks/tasksFirestore'

/**
 * AT-3067: "Show a different focus task" in the assistant-mode header (AnnaFocusTask).
 *
 * The pick is deterministic (calendar event first, then display order), so excluding only the
 * current task would flip between the first two tasks. This module remembers the tasks the user has
 * passed over in this session (in memory, per tab) and excludes them too, so each click brings a task
 * not shown yet. Once every task due today has been passed over, it starts over (decided with the
 * product owner on 2026-11-17): the skip list is cleared and the pick runs again excluding only the
 * current task. The result says `startedOver` so the header can tell the user.
 *
 * At most one swap runs at a time across every mounted header: a second request while one is in
 * flight resolves `{ status: 'busy' }` without touching the focus.
 */

const MAX_SKIPPED = 200
const skippedTaskIds = new Set()
let inFlight = false

const rememberSkipped = taskId => {
    if (!taskId) return
    skippedTaskIds.delete(taskId)
    skippedTaskIds.add(taskId)
    while (skippedTaskIds.size > MAX_SKIPPED) skippedTaskIds.delete(skippedTaskIds.values().next().value)
}

/**
 * @returns {Promise<{ status: 'picked' | 'none' | 'superseded' | 'offline' | 'busy', startedOver: boolean }>}
 *   Rejects when the pick fails (offline: `code: 'offline'`).
 */
export async function rerollFocusTask({ userId, taskId, projectId, onCandidates, pick = pickDifferentFocusTask }) {
    if (inFlight) return { status: 'busy', startedOver: false }
    inFlight = true
    try {
        const skipped = [...skippedTaskIds].filter(id => id !== taskId)
        let status = await pick(userId, { taskId, projectId, skippedTaskIds: skipped, onCandidates })
        let startedOver = false
        if (status === 'none' && skipped.length > 0) {
            // Everything due today has been shown: start over from the top.
            skippedTaskIds.clear()
            startedOver = true
            status = await pick(userId, { taskId, projectId, skippedTaskIds: [], onCandidates })
        }
        // 'offline': the connection dropped after the swap was written; it is queued and shows locally.
        if (status === 'picked' || status === 'offline') rememberSkipped(taskId)
        return { status, startedOver: startedOver && (status === 'picked' || status === 'offline') }
    } finally {
        inFlight = false
    }
}

/** Tests only. */
export const resetFocusRerollSession = () => {
    skippedTaskIds.clear()
    inFlight = false
}

export const getSkippedFocusTaskIds = () => [...skippedTaskIds]
