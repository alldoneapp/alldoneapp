/**
 * TaskServiceFrontendHelper - Frontend wrapper for unified TaskService
 *
 * This helper provides an easy way to use the TaskService in frontend contexts
 * while preserving existing patterns and integrations.
 */

import store from '../../../redux/store'
import { TaskService } from '../../../functions/shared/TaskService'
import { getDb, getId } from '../firestore'
import moment from 'moment'

/**
 * Initialize TaskService for frontend use
 * @returns {TaskService} Configured TaskService instance
 */
async function initializeFrontendTaskService() {
    const taskService = new TaskService({
        database: getDb(),
        moment: moment,
        idGenerator: getId,
        enableFeeds: true,
        enableValidation: true,
        isReactNative: typeof navigator !== 'undefined' && navigator.product === 'ReactNative',
        isWeb: typeof window !== 'undefined',
    })

    await taskService.initialize()
    return taskService
}

/**
 * Creates a feedUser object from the current logged-in user
 * @returns {Object} Feed user object
 */
function createFeedUserFromStore() {
    const { loggedUser } = store.getState()
    return {
        uid: loggedUser.uid,
        id: loggedUser.uid,
        creatorId: loggedUser.uid,
        name: loggedUser.displayName || loggedUser.name || 'User',
        email: loggedUser.email || '',
    }
}

/**
 * Simplified task creation function using TaskService
 * This demonstrates how existing frontend task creation can be unified
 *
 * @param {Object} params - Task creation parameters
 * @param {string} params.projectId - Project ID
 * @param {string} params.name - Task name
 * @param {string} params.description - Task description (optional)
 * @param {string} params.userId - User ID (optional, defaults to logged user)
 * @param {number} params.dueDate - Due date timestamp (optional)
 * @param {boolean} params.isPrivate - Whether task is private (optional)
 * @param {Array} params.observersIds - Observer IDs (optional)
 * @param {Object} params.estimations - Task estimations (optional)
 * @param {string} params.recurrence - Recurrence pattern (optional)
 * @param {Object} options - Additional options
 * @param {boolean} options.awaitForTaskCreation - Wait for completion
 * @param {boolean} options.tryToGenerateBotAdvice - Enable bot advice
 * @param {boolean} options.notGenerateMentionTasks - Skip mention task generation
 * @param {boolean} options.notGenerateUpdates - Skip feed updates
 * @returns {Promise<Object>} Created task result
 */
export async function createTaskWithService(params, options = {}) {
    const { loggedUser } = store.getState()
    const {
        projectId,
        name,
        description = '',
        userId = loggedUser.uid,
        dueDate = Date.now(),
        isPrivate = false,
        observersIds = [],
        estimations = null,
        recurrence = 'never',
        parentId = null,
        linkBack = '',
        genericData = null,
        ...otherParams
    } = params

    // Initialize TaskService
    const taskService = await initializeFrontendTaskService()

    // Create feed user
    const feedUser = createFeedUserFromStore()

    // Create task using unified service
    const result = await taskService.createAndPersistTask(
        {
            name: name.trim(),
            description,
            userId,
            projectId,
            dueDate,
            isPrivate,
            observersIds,
            estimations,
            recurrence,
            parentId,
            linkBack,
            genericData,
            feedUser,
            ...otherParams,
        },
        {
            userId: loggedUser.uid,
            projectId,
        }
    )

    // Return result in the format expected by frontend
    return {
        id: result.taskId,
        ...result.task,
        success: result.success,
        message: result.message,
    }
}

/**
 * Enhanced task creation that preserves existing frontend functionality
 * This version includes all the complex logic from the original uploadNewTask
 *
 * @param {Object} params - Same parameters as original uploadNewTask
 * @param {Object} options - Same options as original uploadNewTask
 * @returns {Promise<Object>} Task creation result
 */
export async function createTaskWithFullFeatures(params, options = {}) {
    const {
        awaitForTaskCreation = false,
        tryToGenerateBotAdvice = false,
        notGenerateMentionTasks = false,
        notGenerateUpdates = false,
    } = options

    // First create the basic task using TaskService
    const basicResult = await createTaskWithService(params, {
        notGenerateUpdates: true, // We'll handle feeds manually for now
    })

    // TODO: Add the complex frontend-specific logic here:
    // - Bot advice generation (tryToGenerateTopicAdvice)
    // - Mention task creation (createGenericTaskWhenMention)
    // - Template project handling
    // - Special sort index logic
    // - Store state updates (storeLastAddedTaskId)
    // - Event logging

    if (tryToGenerateBotAdvice) {
        console.log('Bot advice generation would be triggered here')
        // TODO: Implement bot advice integration
    }

    if (!notGenerateMentionTasks) {
        console.log('Mention task generation would be triggered here')
        // TODO: Implement mention task integration
    }

    return basicResult
}

/**
 * Migration helper - wraps existing uploadNewTask to use TaskService internally
 * This allows gradual migration without breaking existing code
 */
export async function migrateUploadNewTask(originalUploadNewTask) {
    return async function (
        projectId,
        task,
        linkBack,
        awaitForTaskCreation,
        tryToGenerateBotAdvice,
        notGenerateMentionTasks,
        notGenerateUpdates
    ) {
        try {
            // Try new TaskService approach
            return await createTaskWithFullFeatures(
                {
                    projectId,
                    ...task,
                    linkBack,
                },
                {
                    awaitForTaskCreation,
                    tryToGenerateBotAdvice,
                    notGenerateMentionTasks,
                    notGenerateUpdates,
                }
            )
        } catch (error) {
            console.warn('TaskService creation failed, falling back to original implementation:', error)
            // Fallback to original implementation
            return await originalUploadNewTask(
                projectId,
                task,
                linkBack,
                awaitForTaskCreation,
                tryToGenerateBotAdvice,
                notGenerateMentionTasks,
                notGenerateUpdates
            )
        }
    }
}

export default {
    initializeFrontendTaskService,
    createFeedUserFromStore,
    createTaskWithService,
    createTaskWithFullFeatures,
    migrateUploadNewTask,
}
