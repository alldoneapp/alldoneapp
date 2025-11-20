/**
 * TaskServiceFrontendHelper - Frontend wrapper for task creation
 *
 * PHASE 1 (Current): Uses original uploadNewTask for main app to ensure feeds work
 * PHASE 2 (Future): Will migrate to unified TaskService once feed compatibility is complete
 *
 * This maintains existing feed functionality while preserving unified architecture
 * for Assistant tools and MCP server contexts.
 */

import store from '../../../redux/store'
import { uploadNewTask } from './tasksFirestore'

/**
 * Maps modern task parameters to the format expected by uploadNewTask
 * @param {Object} params - Modern task creation parameters
 * @returns {Object} Task object in legacy format
 */
function mapToLegacyTaskFormat(params) {
    const { loggedUser } = store.getState()

    return {
        name: params.name,
        description: params.description || '',
        userId: params.userId || loggedUser.uid,
        dueDate: params.dueDate || Date.now(),
        isPrivate: params.isPrivate || false,
        observersIds: params.observersIds || [],
        estimations: params.estimations || null,
        recurrence: params.recurrence || 'never',
        parentId: params.parentId || null,
        linkBack: params.linkBack || '',
        genericData: params.genericData || null,
        // Map any additional task properties
        ...Object.fromEntries(
            Object.entries(params).filter(
                ([key]) => !['name', 'description', 'userId', 'projectId', 'feedUser'].includes(key)
            )
        ),
    }
}

/**
 * Create task using original uploadNewTask function (PHASE 1 implementation)
 * This ensures feeds work correctly while maintaining the interface expected by components
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

 * @param {boolean} options.notGenerateMentionTasks - Skip mention task generation
 * @param {boolean} options.notGenerateUpdates - Skip feed updates
 * @returns {Promise<Object>} Created task result
 */
export async function createTaskWithService(params, options = {}) {
    const { projectId, linkBack = '', ...taskParams } = params

    const {
        awaitForTaskCreation = false,

        notGenerateMentionTasks = false,
        notGenerateUpdates = false,
    } = options

    // Map to legacy task format
    const taskObject = mapToLegacyTaskFormat(taskParams)

    // Use original uploadNewTask function to ensure feeds work
    const result = await uploadNewTask(
        projectId,
        taskObject,
        linkBack,
        awaitForTaskCreation,

        notGenerateMentionTasks,
        notGenerateUpdates
    )

    return result
}

export default {
    mapToLegacyTaskFormat,
    createTaskWithService,
}
