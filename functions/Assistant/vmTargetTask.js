/**
 * Resolution for execute_task_in_vm's `target_task_id` argument.
 *
 * A delegated assistant has no ambient task thread. When the user asks it to execute an existing
 * task, this resolver lets the VM job use that task as its host instead of creating a duplicate
 * wrapper task. This is intentionally separate from VM continuation: an ordinary task needs no
 * prior vmSessions record, while access is checked through the app's normal project/object model.
 */

const { assertObjectAccess } = require('../shared/privacyAccess')

function taskDocPath(projectId, taskId) {
    return `items/${projectId}/tasks/${taskId}`
}

async function resolveVmTargetTask({ db, projectId, taskId, requestUserId } = {}) {
    const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : ''
    if (!normalizedTaskId) {
        return { ok: false, message: 'target_task_id must be a non-empty task ID.' }
    }
    if (!projectId) {
        return { ok: false, message: 'A project is required to execute an existing task.' }
    }
    if (!requestUserId) {
        return { ok: false, message: 'An authenticated user is required to execute an existing task.' }
    }

    try {
        await assertObjectAccess(db, requestUserId, projectId, 'tasks', normalizedTaskId)
    } catch (error) {
        if (/object not found/i.test(error.message)) {
            return { ok: false, message: 'That task does not exist in the current project.' }
        }
        if (/does not have access/i.test(error.message)) {
            return { ok: false, message: 'You do not have access to that task.' }
        }
        return { ok: false, message: `Could not use that task for the VM run: ${error.message}` }
    }

    const taskSnapshot = await db.doc(taskDocPath(projectId, normalizedTaskId)).get()
    const task = taskSnapshot.data() || {}

    return {
        ok: true,
        objectType: 'tasks',
        objectId: normalizedTaskId,
        isPublicFor: Array.isArray(task.isPublicFor) ? task.isPublicFor : [],
    }
}

module.exports = {
    resolveVmTargetTask,
    taskDocPath,
}
