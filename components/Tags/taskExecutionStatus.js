import {
    VM_SESSION_STATUS_BUSY,
    VM_SESSION_STATUS_FAILED,
    VM_SESSION_STATUS_IDLE_RUNNING,
    VM_SESSION_STATUS_INTERRUPTED,
    VM_SESSION_STATUS_PAUSED,
} from '../../utils/backends/Assistants/vmSessionStatusHelper'

/**
 * AT-3099 — ONE execution status per task row.
 *
 * A row used to carry two status chips side by side: the workflow-run chip (`task.workflowAiStatus`,
 * "Aktiv" / "In Warteschlange") and a VM-session chip (`vmSessions/{projectId}__{taskId}`,
 * "In progress VM" / "Paused VM"). They describe different layers (the workflow step and the sandbox
 * it runs in), so they often disagreed: a step that is working or queued while the sandbox from an
 * earlier run is merely retained read as "Aktiv" + "Paused VM".
 *
 * This resolves both sources to one user-facing state, in order of what the user actually needs to
 * know:
 *
 * 1. Waiting for you: the VM asked a question or needs an approval. Read from `blockedByCorrelationId`,
 *    which every exit (answer, cancel, expiry) clears, never from `lastRunStatus: 'awaiting_user'`,
 *    which stays behind after the question expired.
 * 2. Active: the sandbox is busy, or the workflow step is running / waiting on its VM job.
 * 3. Queued: the step is pending, or jobs wait in the thread's VM queue.
 * 4. Needs attention: the step failed (the chip retries it), or the last VM run failed.
 * 5. Paused: nothing is running and the VM session is only kept for a later continuation.
 *
 * The workflow layer is ignored once the task is done, as before. The VM layer is not: a done task
 * whose session is still kept keeps showing "Pausiert" (confirmed in AT-3099).
 *
 * The technical layer (VM state, last run, queue length) is returned as `details` for the tooltip.
 */

export const EXECUTION_STATE_AWAITING_USER = 'awaiting_user'
export const EXECUTION_STATE_ACTIVE = 'active'
export const EXECUTION_STATE_QUEUED = 'queued'
export const EXECUTION_STATE_NEEDS_ATTENTION = 'needs_attention'
export const EXECUTION_STATE_PAUSED = 'paused'

// Translation keys of the chip label per state.
export const EXECUTION_STATE_LABELS = {
    [EXECUTION_STATE_AWAITING_USER]: 'Waiting for you',
    [EXECUTION_STATE_ACTIVE]: 'Working',
    [EXECUTION_STATE_QUEUED]: 'Queued',
    [EXECUTION_STATE_NEEDS_ATTENTION]: 'Needs attention',
    [EXECUTION_STATE_PAUSED]: 'Paused',
}

const WORKFLOW_STATUS_PENDING = 'pending'
const WORKFLOW_STATUS_RUNNING = 'running'
const WORKFLOW_STATUS_AWAITING_VM = 'awaiting_vm'
const WORKFLOW_STATUS_FAILED = 'failed'

const VM_FAILED_RUN_STATUSES = [VM_SESSION_STATUS_FAILED, VM_SESSION_STATUS_INTERRUPTED]
const VM_RETAINED_STATUSES = [VM_SESSION_STATUS_IDLE_RUNNING, VM_SESSION_STATUS_PAUSED]

const getQueueLength = session => {
    if (Array.isArray(session?.queue)) return session.queue.length
    const length = Number(session?.queueLength)
    return Number.isFinite(length) && length > 0 ? length : 0
}

const isVmAwaitingUser = session => !!session?.blockedByCorrelationId

const hasVmFailure = session => {
    if (!session) return false
    if (session.status === VM_SESSION_STATUS_FAILED) return true
    return VM_RETAINED_STATUSES.includes(session.status) && VM_FAILED_RUN_STATUSES.includes(session.lastRunStatus)
}

/**
 * Technical VM facts for the tooltip, as `{ key, params }` translation descriptors so the resolver
 * stays free of i18n and is testable on its own.
 */
export function getVmStatusDetails(session) {
    if (!session) return []
    const details = []

    if (isVmAwaitingUser(session)) details.push({ key: 'vm_workspace_awaiting' })

    const vmStateKey = {
        [VM_SESSION_STATUS_BUSY]: 'vm_workspace_running',
        [VM_SESSION_STATUS_IDLE_RUNNING]: 'vm_status_detail_idle',
        [VM_SESSION_STATUS_PAUSED]: 'vm_workspace_paused',
        [VM_SESSION_STATUS_FAILED]: 'vm_workspace_failed',
        [VM_SESSION_STATUS_INTERRUPTED]: 'vm_workspace_failed',
    }[session.status]
    if (vmStateKey) details.push({ key: 'vm_status_detail_session', params: { stateKey: vmStateKey } })

    if (session.status !== VM_SESSION_STATUS_FAILED && hasVmFailure(session)) {
        details.push({ key: 'vm_status_detail_last_run_failed' })
    }

    const queueLength = getQueueLength(session)
    if (queueLength > 0) details.push({ key: 'vm_workspace_waiting', params: { count: queueLength } })

    if (VM_RETAINED_STATUSES.includes(session.status) && !isVmAwaitingUser(session) && !hasVmFailure(session)) {
        details.push({ key: 'vm_workspace_paused_hint' })
    }

    return details
}

/**
 * @param {object} params
 * @param {object} [params.task] the task row (`done`, `workflowAiStatus`)
 * @param {object|null} [params.session] the task's `vmSessions` document, or null
 * @returns {null | { state: string, retryable: boolean, details: Array<{ key: string, params?: object }> }}
 */
export function resolveTaskExecutionStatus({ task, session } = {}) {
    const workflowStatus = task?.done ? null : task?.workflowAiStatus?.status || null
    const details = getVmStatusDetails(session)
    const result = (state, retryable = false) => ({ state, retryable, details })

    if (isVmAwaitingUser(session)) return result(EXECUTION_STATE_AWAITING_USER)
    if (session?.status === VM_SESSION_STATUS_BUSY) return result(EXECUTION_STATE_ACTIVE)
    if (workflowStatus === WORKFLOW_STATUS_RUNNING || workflowStatus === WORKFLOW_STATUS_AWAITING_VM) {
        return result(EXECUTION_STATE_ACTIVE)
    }
    if (workflowStatus === WORKFLOW_STATUS_PENDING || getQueueLength(session) > 0) {
        return result(EXECUTION_STATE_QUEUED)
    }
    if (workflowStatus === WORKFLOW_STATUS_FAILED) return result(EXECUTION_STATE_NEEDS_ATTENTION, true)
    if (hasVmFailure(session)) return result(EXECUTION_STATE_NEEDS_ATTENTION)
    if (VM_RETAINED_STATUSES.includes(session?.status)) return result(EXECUTION_STATE_PAUSED)

    return null
}
