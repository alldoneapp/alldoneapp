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

const VM_SESSION_OBJECTIVE_MAX = 200

/**
 * Condense a run's objective to a recognizable one-liner for the session doc. Stored so thread
 * discovery can say what each continuable VM was working on without joining back to vmJobs.
 */
function summarizeVmObjectiveForSession(objective) {
    const raw = typeof objective === 'string' ? objective.trim() : ''
    if (!raw) return ''
    const firstLine = raw.split('\n')[0].trim() || raw
    if (firstLine.length <= VM_SESSION_OBJECTIVE_MAX) return firstLine
    return `${firstLine.slice(0, VM_SESSION_OBJECTIVE_MAX - 1).trimEnd()}…`
}

/**
 * Path (relative to the app base URL) of a VM host thread's chat. Kept here as a pure helper so
 * both the dispatcher (which returns the link to the calling assistant) and the runner (which
 * links the host thread from result notifications) build the same URL.
 */
function buildVmChatPath(projectId, objectType, objectId) {
    return `/projects/${projectId}/${objectType === 'topics' ? 'chats' : objectType}/${objectId}/chat`
}

/**
 * Pick the host-thread reference out of a startVmJob result, or null when the call didn't start a
 * job (validation failure, launch failure) or predates the host-thread fields.
 */
function normalizeStartedVmJob(toolResult) {
    if (!toolResult || typeof toolResult !== 'object') return null
    if (toolResult.success === false) return null
    const url = String(toolResult.hostThreadUrl || '').trim()
    const objectId = String(toolResult.hostObjectId || '').trim()
    if (!url || !objectId) return null
    return {
        objectId,
        objectType: String(toolResult.hostObjectType || 'tasks').trim() || 'tasks',
        projectId: String(toolResult.hostProjectId || '').trim(),
        url,
    }
}

/**
 * Guarantee the user gets a way into the thread where a VM job is actually running.
 *
 * The assistant is asked to include the link (the tool result says so), but a dispatched job the
 * user can't find is a bad enough outcome to not leave to prose — especially through delegation,
 * where the host thread lives in a different project than the conversation the user is in. Mirrors
 * ensureCreatedNoteLinksInResponse.
 */
function ensureVmHostThreadLinksInResponse(responseText, startedVmJobs = [], currentThread = null) {
    let response = typeof responseText === 'string' ? responseText.trim() : ''
    const seen = new Set()
    const currentProjectId = String(currentThread?.projectId || '').trim()
    const currentObjectId = String(currentThread?.objectId || '').trim()

    for (const job of startedVmJobs.map(normalizeStartedVmJob).filter(Boolean)) {
        if (seen.has(job.objectId)) continue
        seen.add(job.objectId)
        // The user is already reading the host thread — linking them to where they are is noise.
        if (currentObjectId && job.objectId === currentObjectId && job.projectId === currentProjectId) continue
        if (response.includes(job.url)) continue

        const label = 'Follow it here:'
        response = response ? `${response}\n\n${label} ${job.url}` : `${label} ${job.url}`
    }

    return response
}

module.exports = {
    buildVmJobTaskName,
    buildVmJobTaskDescription,
    buildVmChatPath,
    summarizeVmObjectiveForSession,
    normalizeStartedVmJob,
    ensureVmHostThreadLinksInResponse,
    VM_JOB_TASK_NAME_MAX,
    VM_SESSION_OBJECTIVE_MAX,
}
