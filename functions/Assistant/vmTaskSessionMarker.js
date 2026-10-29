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
// Mirrors the task's `done` onto its `vmSessions` document (AT-2916). The Anna VM overview lists a
// user's paused VMs the way the task list badges them, i.e. only on OPEN tasks; without this copy it
// would have to read every paused session's task on every poll just to learn that it is done (all
// 33 paused sessions in the reporting project were on done tasks).
const SESSION_TASK_DONE_FIELD = 'taskDone'

async function writeSessionTaskDone(sessionRef, done) {
    try {
        // update(), not set({merge}): a session cleaned up in between must not come back as a stub.
        await sessionRef.update({ [SESSION_TASK_DONE_FIELD]: done === true })
        return true
    } catch (error) {
        if (error?.code !== 5 && !/no document|not.?found/i.test(error?.message || ''))
            console.warn('🖥️ VM JOB: could not mirror task state onto its VM session', { error: error?.message })
        return false
    }
}

async function markTaskHasVmSession({ projectId, objectType, objectId, db, sessionRef = null }) {
    if (objectType !== 'tasks' || !projectId || !objectId) return false
    try {
        const taskRef = (db || admin.firestore()).doc(`items/${projectId}/tasks/${objectId}`)
        const snapshot = await taskRef.get()
        if (!snapshot.exists) return false
        if (sessionRef) await writeSessionTaskDone(sessionRef, (snapshot.data() || {}).done)
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

// Called from onUpdateTaskSecondGen (no trigger of its own): only a VM task whose `done` flipped
// writes anything, so the ordinary task update costs nothing here.
async function syncVmSessionTaskDoneOnTaskUpdate({ projectId, taskId, before = {}, after = {}, db }) {
    if (!projectId || !taskId || after[TASK_VM_SESSION_FIELD] !== true) return false
    if ((before.done === true) === (after.done === true)) return false
    return writeSessionTaskDone((db || admin.firestore()).doc(`vmSessions/${projectId}__${taskId}`), after.done)
}

module.exports = {
    TASK_VM_SESSION_FIELD,
    SESSION_TASK_DONE_FIELD,
    markTaskHasVmSession,
    syncVmSessionTaskDoneOnTaskUpdate,
}
