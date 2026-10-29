/**
 * Marks a task whose thread has ever hosted a VM job (AT-2907).
 *
 * The task list shows a VM badge per task and counts VM states for the filter line, both from
 * `vmSessions/{projectId}__{taskId}`. Without a marker the app had to watch that document for
 * EVERY open task and subtask, about a hundred listeners per tab, while production held 39
 * session documents in total. With `hasVmSession` on the task, the app watches only tasks that
 * can have a session.
 *
 * Written once per thread at admission (the first point every VM job passes), never cleared:
 * a task whose idle session was cleaned up keeps one cheap listener on a missing document.
 * Like `vmMergeRequest`, it carries no edition data, so it does not count as an edit.
 */
const admin = require('firebase-admin')

const TASK_VM_SESSION_FIELD = 'hasVmSession'

async function markTaskHasVmSession({ projectId, objectType, objectId, db }) {
    if (objectType !== 'tasks' || !projectId || !objectId) return false
    try {
        const taskRef = (db || admin.firestore()).doc(`items/${projectId}/tasks/${objectId}`)
        const snapshot = await taskRef.get()
        if (!snapshot.exists) return false
        if ((snapshot.data() || {})[TASK_VM_SESSION_FIELD] === true) return false
        // update(), not set({merge}): a task deleted in between must not come back as a stub.
        await taskRef.update({ [TASK_VM_SESSION_FIELD]: true })
        return true
    } catch (error) {
        // The badge is a convenience; a failed marker must never stop the VM job.
        console.warn('🖥️ VM JOB: could not mark the task as hosting a VM session', {
            projectId,
            objectId,
            error: error.message,
        })
        return false
    }
}

module.exports = { TASK_VM_SESSION_FIELD, markTaskHasVmSession }
