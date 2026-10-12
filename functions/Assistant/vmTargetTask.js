/**
 * Resolution for execute_task_in_vm's `target_task_id` argument.
 *
 * A delegated assistant has no ambient task thread. When the user asks it to execute an existing
 * task, this resolver lets the VM job use that task as its host instead of creating a duplicate
 * wrapper task. This is intentionally separate from VM continuation: an ordinary task needs no
 * prior vmSessions record, while access is checked through the app's normal project/object model.
 */

const { assertObjectAccess, canAccessObject } = require('../shared/privacyAccess')

function taskDocPath(projectId, taskId) {
    return `items/${projectId}/tasks/${taskId}`
}

async function resolveVmTargetTask({ db, projectId, targetProjectId, preferredProjectId, taskId, requestUserId } = {}) {
    const normalizedTaskId = typeof taskId === 'string' ? taskId.trim() : ''
    if (!normalizedTaskId) {
        return { ok: false, message: 'target_task_id must be a non-empty task ID.' }
    }
    const explicitProjectId = typeof targetProjectId === 'string' ? targetProjectId.trim() : ''
    if (!projectId && !explicitProjectId) {
        return { ok: false, message: 'A project is required to execute an existing task.' }
    }
    if (!requestUserId) {
        return { ok: false, message: 'An authenticated user is required to execute an existing task.' }
    }

    const resolveInProject = async candidateProjectId => {
        try {
            await assertObjectAccess(db, requestUserId, candidateProjectId, 'tasks', normalizedTaskId)
        } catch (error) {
            if (/object not found/i.test(error.message)) return { ok: false, missing: true }
            if (/does not have access/i.test(error.message)) return { ok: false, denied: true }
            throw error
        }

        const taskSnapshot = await db.doc(taskDocPath(candidateProjectId, normalizedTaskId)).get()
        if (!taskSnapshot.exists) return { ok: false, missing: true }
        const task = taskSnapshot.data() || {}
        if (!canAccessObject(task, requestUserId)) return { ok: false, denied: true }
        return {
            ok: true,
            projectId: candidateProjectId,
            objectType: 'tasks',
            objectId: normalizedTaskId,
            isPublicFor: Array.isArray(task.isPublicFor) ? task.isPublicFor : [],
        }
    }

    try {
        // A supplied project is authoritative: never silently run a same-ID task elsewhere.
        if (explicitProjectId) {
            const target = await resolveInProject(explicitProjectId)
            return target.ok
                ? target
                : {
                      ok: false,
                      message: target.denied
                          ? 'You do not have access to that task.'
                          : 'That task does not exist in the specified project.',
                  }
        }

        // Delegates run in their own home project. When the requested task is the originating
        // conversation, prefer that known location; otherwise preserve the current-project path.
        const checkedProjects = new Set([preferredProjectId, projectId].filter(Boolean))
        let denied = false
        for (const candidateProjectId of checkedProjects) {
            const target = await resolveInProject(candidateProjectId)
            if (target.ok) return target
            denied = denied || target.denied
        }

        // Membership comes from the project documents, not a potentially stale users.projectIds.
        // Check object privacy too; knowing an ID is never enough to launch against that object.
        const projects = await db.collection('projects').where('userIds', 'array-contains', requestUserId).get()
        const matches = []
        for (const project of projects.docs) {
            if (checkedProjects.has(project.id)) continue
            const target = await resolveInProject(project.id)
            if (target.ok) matches.push(target)
            denied = denied || target.denied
        }
        if (matches.length === 1) return matches[0]
        if (matches.length > 1) {
            return {
                ok: false,
                message:
                    'That task ID exists in multiple accessible projects. Supply target_project_id to choose the intended task.',
            }
        }
        return {
            ok: false,
            message: denied
                ? 'You do not have access to that task.'
                : 'That task was not found in your accessible projects.',
        }
    } catch (error) {
        return { ok: false, message: `Could not use that task for the VM run: ${error.message}` }
    }
}

module.exports = {
    resolveVmTargetTask,
    taskDocPath,
}
