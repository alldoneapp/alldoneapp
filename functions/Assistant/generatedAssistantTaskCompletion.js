const admin = require('firebase-admin')
const moment = require('moment')

const { requestsOnDemandAssistantTaskCompletion } = require('../shared/assistantTaskCompletionContract')

const INVALID_TASK_PROVENANCE = 'invalid_task_provenance'

class GeneratedAssistantTaskCompletionError extends Error {
    constructor(message, code = 'task_completion_failed') {
        super(message)
        this.name = 'GeneratedAssistantTaskCompletionError'
        this.code = code
    }
}

async function completeGeneratedAssistantTask(
    projectId,
    generatedTaskId,
    activatorUserId,
    activatorData = {},
    options = {}
) {
    if (!generatedTaskId) {
        throw new Error('Cannot complete generated assistant task because the task ID is missing')
    }

    const database = options.database || admin.firestore()
    let currentTask = options.currentTask
    if (!currentTask) {
        const taskSnapshot = await database.doc(`items/${projectId}/tasks/${generatedTaskId}`).get()

        if (!taskSnapshot.exists) {
            throw new Error(`Generated assistant task ${generatedTaskId} was not found`)
        }
        currentTask = { id: generatedTaskId, ...taskSnapshot.data() }
    }

    if (currentTask.done === true && currentTask.inDone === true) {
        return { success: true, persisted: false, alreadyCompleted: true, taskId: generatedTaskId }
    }

    const { TaskService } = require('../shared/TaskService')
    const taskService = new TaskService({
        database,
        moment,
        enableFeeds: true,
        enableValidation: false,
        isCloudFunction: true,
    })
    await taskService.initialize()

    const feedUser = {
        uid: activatorUserId,
        id: activatorUserId,
        creatorId: activatorUserId,
        name: activatorData.name || activatorData.displayName || 'User',
        displayName: activatorData.displayName || activatorData.name || 'User',
        email: activatorData.email || '',
    }

    const result = await taskService.updateAndPersistTask(
        {
            taskId: generatedTaskId,
            projectId,
            currentTask,
            completed: true,
            feedUser,
            initiatorId: activatorUserId,
        },
        {
            projectId,
            userId: activatorUserId,
            lastEditorId: activatorUserId,
        },
        {
            projectId,
            feedUser,
        }
    )

    console.log('Marked generated assistant task as done:', {
        projectId,
        generatedTaskId,
        activatorUserId,
        persisted: result.persisted,
    })

    return result
}

async function finalizeGeneratedAssistantTask(
    { taskResult, projectId, generatedTaskId, activatorUserId, activatorData },
    completeTask = completeGeneratedAssistantTask
) {
    if (!taskResult || taskResult.success !== true) {
        throw new Error('Recurring assistant task did not return a successful execution result')
    }

    return completeTask(projectId, generatedTaskId, activatorUserId, activatorData)
}

function assertOnDemandAssistantTaskProvenance(task, { userId, assistantId, taskMetadata }) {
    if (!requestsOnDemandAssistantTaskCompletion(taskMetadata)) {
        throw new GeneratedAssistantTaskCompletionError(
            'The assistant run did not request server-owned task completion',
            INVALID_TASK_PROVENANCE
        )
    }
    if (!requestsOnDemandAssistantTaskCompletion(task?.taskMetadata)) {
        throw new GeneratedAssistantTaskCompletionError(
            'The generated task is missing server-owned completion provenance',
            INVALID_TASK_PROVENANCE
        )
    }
    if (task.creatorId !== userId) {
        throw new GeneratedAssistantTaskCompletionError(
            'The generated task creator does not match the authenticated user',
            INVALID_TASK_PROVENANCE
        )
    }
    if (task.assistantId !== assistantId || task.userId !== assistantId) {
        throw new GeneratedAssistantTaskCompletionError(
            'The generated task assignee does not match the executing assistant',
            INVALID_TASK_PROVENANCE
        )
    }
    if (task.workflowTask === true || task.executionMode === 'workflow') {
        throw new GeneratedAssistantTaskCompletionError(
            'Workflow tasks must be completed by their workflow',
            INVALID_TASK_PROVENANCE
        )
    }
}

async function finalizeOnDemandAssistantTask({
    taskResult,
    projectId,
    taskId,
    userId,
    assistantId,
    taskMetadata,
    database = admin.firestore(),
}) {
    if (!taskResult || taskResult.success !== true) {
        throw new GeneratedAssistantTaskCompletionError('The assistant run did not succeed')
    }

    const taskSnapshot = await database.doc(`items/${projectId}/tasks/${taskId}`).get()
    if (!taskSnapshot.exists) {
        throw new GeneratedAssistantTaskCompletionError(
            `Generated on-demand assistant task ${taskId} was not found`,
            INVALID_TASK_PROVENANCE
        )
    }

    const currentTask = { id: taskId, ...taskSnapshot.data() }
    assertOnDemandAssistantTaskProvenance(currentTask, { userId, assistantId, taskMetadata })

    const userSnapshot = await database.doc(`users/${userId}`).get()
    const userData = userSnapshot.exists ? userSnapshot.data() || {} : {}
    const completion = await completeGeneratedAssistantTask(projectId, taskId, userId, userData, {
        database,
        currentTask,
    })

    return {
        status: 'succeeded',
        taskId,
        persisted: completion.persisted !== false,
        alreadyCompleted: completion.alreadyCompleted === true,
    }
}

async function completeOnDemandAssistantTaskAfterRun(input, logger = console) {
    if (!requestsOnDemandAssistantTaskCompletion(input.taskMetadata) || input.taskResult?.success !== true) {
        return null
    }

    try {
        return await finalizeOnDemandAssistantTask(input)
    } catch (error) {
        const status = error?.code === INVALID_TASK_PROVENANCE ? 'rejected' : 'failed'
        logger.error('Could not complete generated on-demand assistant task on the server:', {
            projectId: input.projectId,
            taskId: input.taskId,
            userId: input.userId,
            assistantId: input.assistantId,
            status,
            errorCode: error?.code || null,
            errorMessage: error?.message || String(error),
        })
        return {
            status,
            taskId: input.taskId,
            errorCode: error?.code || 'task_completion_failed',
        }
    }
}

module.exports = {
    GeneratedAssistantTaskCompletionError,
    INVALID_TASK_PROVENANCE,
    completeGeneratedAssistantTask,
    finalizeGeneratedAssistantTask,
    assertOnDemandAssistantTaskProvenance,
    finalizeOnDemandAssistantTask,
    completeOnDemandAssistantTaskAfterRun,
}
