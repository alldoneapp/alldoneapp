'use strict'

function getCurrentWorkflowStep(task = {}) {
    if (task.done || task.inDone) return 'done'
    const stepHistory = Array.isArray(task.stepHistory) ? task.stepHistory : []
    return stepHistory.length > 0 ? stepHistory[stepHistory.length - 1] : null
}

function didWorkflowStepChange(oldTask = {}, newTask = {}) {
    return (
        getCurrentWorkflowStep(oldTask) !== getCurrentWorkflowStep(newTask) ||
        oldTask.currentReviewerId !== newTask.currentReviewerId
    )
}

async function reconcileTaskMergeStatusAfterWorkflowChange({ projectId, taskId, oldTask, newTask }) {
    if (!newTask?.vmMergeRequest?.url || !didWorkflowStepChange(oldTask, newTask)) return null

    try {
        // Load this only for connected workflow transitions. Besides keeping ordinary task updates
        // cheap, this avoids loading the provider SDK path in callers that never need it.
        const { refreshTaskMergeStatus } = require('./mergeStatus')
        return await refreshTaskMergeStatus({
            userId: newTask.lastEditorId || null,
            projectId,
            taskId,
            force: true,
        })
    } catch (error) {
        // A workflow update must still succeed if provider credentials are unavailable or the
        // provider is temporarily down. The normal UI refresh remains available for a later retry.
        console.warn('VM merge status: workflow reconciliation failed', {
            projectId,
            taskId,
            provider: newTask.vmMergeRequest.provider || null,
            error: error.message,
        })
        return null
    }
}

module.exports = {
    didWorkflowStepChange,
    reconcileTaskMergeStatusAfterWorkflowChange,
}
