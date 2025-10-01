/**
 * TaskValidator - Universal task validation utility
 *
 * This module provides consistent validation logic for task creation and updates
 * across all platforms and contexts (MCP Server, Assistant, Frontend, Cloud Functions).
 */

/**
 * Validates required task creation parameters
 * @param {Object} params - Task parameters to validate
 * @param {string} params.name - Task name
 * @param {string} params.userId - User ID
 * @param {string} params.projectId - Project ID (optional for some contexts)
 * @throws {Error} If validation fails
 */
function validateRequiredFields(params) {
    const { name, userId, projectId } = params

    // Task name validation
    if (!name) {
        throw new Error('Missing required field: name')
    }
    if (typeof name !== 'string') {
        throw new Error('Task name must be a string')
    }
    if (!name.trim()) {
        throw new Error('Task name cannot be empty')
    }
    if (name.length > 500) {
        throw new Error('Task name cannot exceed 500 characters')
    }

    // User ID validation
    if (!userId) {
        throw new Error('Missing required field: userId')
    }
    if (typeof userId !== 'string') {
        throw new Error('User ID must be a string')
    }

    // Project ID validation (may be optional in some contexts)
    if (projectId !== undefined && projectId !== null) {
        if (typeof projectId !== 'string') {
            throw new Error('Project ID must be a string')
        }
        if (!projectId.trim()) {
            throw new Error('Project ID cannot be empty if provided')
        }
    }
}

/**
 * Validates optional task parameters
 * @param {Object} params - Task parameters to validate
 */
function validateOptionalFields(params) {
    const { description, dueDate, userIds, observersIds, estimations, recurrence } = params

    // Description validation
    if (description !== undefined && description !== null) {
        if (typeof description !== 'string') {
            throw new Error('Task description must be a string')
        }
        if (description.length > 5000) {
            throw new Error('Task description cannot exceed 5000 characters')
        }
    }

    // Due date validation
    if (dueDate !== undefined && dueDate !== null) {
        if (typeof dueDate !== 'number') {
            throw new Error('Due date must be a number (timestamp)')
        }
        if (dueDate < 0) {
            throw new Error('Due date must be a positive timestamp')
        }
        // Don't allow dates too far in the future (100 years)
        const maxDate = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000
        if (dueDate > maxDate) {
            throw new Error('Due date cannot be more than 100 years in the future')
        }
    }

    // User IDs validation
    if (userIds !== undefined && userIds !== null) {
        if (!Array.isArray(userIds)) {
            throw new Error('User IDs must be an array')
        }
        if (userIds.length === 0) {
            throw new Error('User IDs array cannot be empty if provided')
        }
        if (userIds.length > 100) {
            throw new Error('Cannot assign task to more than 100 users')
        }
        userIds.forEach((uid, index) => {
            if (typeof uid !== 'string' || !uid.trim()) {
                throw new Error(`Invalid user ID at index ${index}: must be a non-empty string`)
            }
        })
    }

    // Observers validation
    if (observersIds !== undefined && observersIds !== null) {
        if (!Array.isArray(observersIds)) {
            throw new Error('Observer IDs must be an array')
        }
        if (observersIds.length > 50) {
            throw new Error('Cannot have more than 50 observers on a task')
        }
        observersIds.forEach((oid, index) => {
            if (typeof oid !== 'string' || !oid.trim()) {
                throw new Error(`Invalid observer ID at index ${index}: must be a non-empty string`)
            }
        })
    }

    // Estimations validation
    if (estimations !== undefined && estimations !== null) {
        if (typeof estimations !== 'object' || Array.isArray(estimations)) {
            throw new Error('Estimations must be an object')
        }
        Object.keys(estimations).forEach(step => {
            const estimation = estimations[step]
            if (typeof estimation !== 'number' || estimation < 0) {
                throw new Error(`Estimation for step '${step}' must be a non-negative number`)
            }
            if (estimation > 1000) {
                throw new Error(`Estimation for step '${step}' cannot exceed 1000`)
            }
        })
    }

    // Recurrence validation
    if (recurrence !== undefined && recurrence !== null) {
        const validRecurrences = [
            'never',
            'daily',
            'everyWorkday',
            'weekly',
            'every2Weeks',
            'every3Weeks',
            'monthly',
            'every3Months',
            'every6Months',
            'annually',
        ]
        if (!validRecurrences.includes(recurrence)) {
            throw new Error(`Invalid recurrence: ${recurrence}. Must be one of: ${validRecurrences.join(', ')}`)
        }
    }
}

/**
 * Validates task creation context (authentication, permissions, etc.)
 * @param {Object} context - Context information
 * @param {string} context.userId - User performing the action
 * @param {string} context.projectId - Project where task is being created
 * @param {Array} context.projectUserIds - Users with access to the project
 * @throws {Error} If validation fails
 */
function validateCreationContext(context) {
    const { userId, projectId, projectUserIds } = context

    if (!userId) {
        throw new Error('User ID is required in creation context')
    }

    if (!projectId) {
        throw new Error('Project ID is required in creation context')
    }

    // Check if user has access to the project
    if (Array.isArray(projectUserIds) && !projectUserIds.includes(userId)) {
        throw new Error('User does not have access to this project')
    }
}

/**
 * Validates task update parameters
 * @param {Object} params - Update parameters
 * @param {string} params.taskId - Task ID being updated
 * @param {string} params.userId - User performing the update
 * @param {Object} params.updates - Fields being updated
 */
function validateTaskUpdate(params) {
    const { taskId, userId, updates } = params

    if (!taskId || typeof taskId !== 'string') {
        throw new Error('Task ID is required and must be a string')
    }

    if (!userId || typeof userId !== 'string') {
        throw new Error('User ID is required and must be a string')
    }

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        throw new Error('Updates must be a non-empty object')
    }

    if (Object.keys(updates).length === 0) {
        throw new Error('At least one field must be updated')
    }

    // Validate individual update fields
    validateOptionalFields(updates)

    // Prevent updating immutable fields
    const immutableFields = ['id', 'created', 'creatorId']
    immutableFields.forEach(field => {
        if (updates.hasOwnProperty(field)) {
            throw new Error(`Field '${field}' cannot be updated`)
        }
    })
}

/**
 * Validates batch task operations
 * @param {Array} tasks - Array of tasks to validate
 * @param {number} maxBatchSize - Maximum allowed batch size
 */
function validateBatchOperation(tasks, maxBatchSize = 100) {
    if (!Array.isArray(tasks)) {
        throw new Error('Tasks must be an array')
    }

    if (tasks.length === 0) {
        throw new Error('Batch operation cannot be empty')
    }

    if (tasks.length > maxBatchSize) {
        throw new Error(`Batch operation cannot exceed ${maxBatchSize} tasks`)
    }

    // Validate each task in the batch
    tasks.forEach((task, index) => {
        try {
            if (task.name !== undefined) {
                // This is a creation operation
                validateRequiredFields(task)
                validateOptionalFields(task)
            } else if (task.taskId !== undefined) {
                // This is an update operation
                validateTaskUpdate(task)
            } else {
                throw new Error('Task must have either name (creation) or taskId (update)')
            }
        } catch (error) {
            throw new Error(`Validation failed for task at index ${index}: ${error.message}`)
        }
    })
}

/**
 * Comprehensive task validation
 * @param {Object} params - All task parameters
 * @param {Object} context - Creation context (optional)
 */
function validateTask(params, context = null) {
    validateRequiredFields(params)
    validateOptionalFields(params)

    if (context) {
        validateCreationContext(context)
    }
}

// CommonJS export - works with Node.js and can be converted by bundlers
module.exports = {
    validateRequiredFields,
    validateOptionalFields,
    validateCreationContext,
    validateTaskUpdate,
    validateBatchOperation,
    validateTask,
    default: validateTask,
}
