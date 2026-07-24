/**
 * Helpers for the task that hosts a VM job when execute_task_in_vm is invoked outside any
 * conversation. Kept in a standalone module (no heavy deps) so it can be unit-tested without
 * importing the full assistantHelper (which pulls in the OpenAI SDK).
 */

const VM_JOB_TASK_NAME_MAX = 120

/**
 * Build a concise task title from a VM job objective. Uses the first non-empty line, capped to
 * a reasonable length so the host task reads cleanly in task lists.
 */
function buildVmJobTaskName(objective) {
    const raw = typeof objective === 'string' ? objective.trim() : ''
    if (!raw) return 'VM task'
    const firstLine = raw.split('\n')[0].trim() || raw
    if (firstLine.length <= VM_JOB_TASK_NAME_MAX) return firstLine
    return `${firstLine.slice(0, VM_JOB_TASK_NAME_MAX - 1).trimEnd()}…`
}

/**
 * Build the description for a VM host task so it is self-documenting in the UI and survives
 * into later resumes: the objective, the expected deliverable, and the user's original request
 * (when it adds something beyond the objective). Image embedding is applied by the caller via
 * mergeTaskDescriptionWithImages. Returns '' when there is nothing to record.
 */
function buildVmJobTaskDescription({ objective, deliverable, originatingRequestText } = {}) {
    const parts = []
    const obj = typeof objective === 'string' ? objective.trim() : ''
    if (obj) parts.push(obj)
    const del = typeof deliverable === 'string' ? deliverable.trim() : ''
    if (del) parts.push(`**Deliverable:** ${del}`)
    const req = typeof originatingRequestText === 'string' ? originatingRequestText.trim() : ''
    if (req && req !== obj) parts.push(`**Original request:** ${req}`)
    return parts.join('\n\n')
}

module.exports = {
    buildVmJobTaskName,
    buildVmJobTaskDescription,
    VM_JOB_TASK_NAME_MAX,
}
