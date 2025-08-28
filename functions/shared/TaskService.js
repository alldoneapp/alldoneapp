/**
 * TaskService - Universal task management service
 *
 * This service provides a unified API for task creation, validation, and feed generation
 * that works across all platforms and contexts:
 * - MCP Server (Cloud Functions)
 * - Assistant Tool calls (Cloud Functions)
 * - Frontend UI components (React Native/Web)
 * - Backend operations (Cloud Functions)
 * - Any other task creation contexts
 */

// Import shared utilities (using dynamic imports for cross-platform compatibility)
let TaskModelBuilder, TaskValidator, TaskFeedGenerator

// Dynamic imports for cross-platform compatibility
async function loadDependencies() {
    if (!TaskModelBuilder) {
        try {
            // Try CommonJS first (Node.js/Cloud Functions)
            if (typeof require !== 'undefined') {
                TaskModelBuilder = require('./TaskModelBuilder')
                TaskValidator = require('./TaskValidator')
                TaskFeedGenerator = require('./TaskFeedGenerator')
            } else {
                // Fall back to ES6 imports (React Native/Web)
                const [tmb, tv, tfg] = await Promise.all([
                    import('./TaskModelBuilder'),
                    import('./TaskValidator'),
                    import('./TaskFeedGenerator'),
                ])
                TaskModelBuilder = tmb
                TaskValidator = tv
                TaskFeedGenerator = tfg
            }
        } catch (error) {
            console.error('Failed to load TaskService dependencies:', error)
            throw new Error('TaskService initialization failed')
        }
    }
}

class TaskService {
    constructor(options = {}) {
        this.options = {
            // Database interface (Firestore admin, client, etc.)
            database: null,

            // Moment.js instance for date handling
            moment: null,

            // Custom ID generator function
            idGenerator: null,

            // Batch operations support
            batchWrapper: null,

            // Environment-specific options
            isCloudFunction: typeof process !== 'undefined' && process.env.FUNCTIONS_EMULATOR !== undefined,
            isReactNative: typeof navigator !== 'undefined' && navigator.product === 'ReactNative',
            isWeb: typeof window !== 'undefined',

            // Feature flags
            enableFeeds: true,
            enableValidation: true,
            enableBatching: true,

            // Override any defaults
            ...options,
        }

        this.initialized = false
    }

    /**
     * Initialize the service (load dependencies)
     */
    async initialize() {
        if (this.initialized) return

        await loadDependencies()
        this.initialized = true
    }

    /**
     * Ensure service is initialized
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize()
        }
    }

    /**
     * Generate a unique task ID
     * @returns {string} Unique task ID
     */
    generateTaskId() {
        if (this.options.idGenerator) {
            return this.options.idGenerator()
        }

        // Use database ID generation if available
        if (this.options.database && this.options.database.collection) {
            try {
                return this.options.database.collection('_').doc().id
            } catch (error) {
                // Fall through to default generation
            }
        }

        // Fallback ID generation
        return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    }

    /**
     * Validate task creation parameters
     * @param {Object} params - Task parameters
     * @param {Object} context - Creation context
     */
    async validateTaskCreation(params, context = null) {
        await this.ensureInitialized()

        if (this.options.enableValidation) {
            TaskValidator.validateTask(params, context)
        }
    }

    /**
     * Create a complete task object
     * @param {Object} params - Task creation parameters
     * @returns {Object} Complete task object
     */
    async buildTask(params) {
        await this.ensureInitialized()

        const taskId = params.taskId || this.generateTaskId()
        const now = params.now || Date.now()

        return TaskModelBuilder.createTaskObject({
            ...params,
            taskId,
            now,
            moment: this.options.moment,
        })
    }

    /**
     * Create task feed data
     * @param {string} eventType - Type of event ('created', 'followed', 'updated')
     * @param {Object} params - Feed parameters
     * @returns {Object} Feed data
     */
    async createTaskFeed(eventType, params) {
        await this.ensureInitialized()

        if (!this.options.enableFeeds) {
            return null
        }

        return TaskFeedGenerator.createTaskEventFeed(eventType, {
            ...params,
            moment: this.options.moment,
            idGenerator: this.options.idGenerator,
        })
    }

    /**
     * Create a new task with all associated data (task object, feeds, etc.)
     * @param {Object} params - Task creation parameters
     * @param {string} params.name - Task name (required)
     * @param {string} params.description - Task description (optional)
     * @param {string} params.userId - User ID creating the task (required)
     * @param {string} params.projectId - Project ID (required)
     * @param {number} params.dueDate - Due date timestamp (optional)
     * @param {Object} params.feedUser - User object for feed creation
     * @param {Object} context - Additional context (permissions, etc.)
     * @returns {Object} Complete task creation result
     */
    async createTask(params, context = {}) {
        await this.ensureInitialized()

        const { feedUser, ...taskParams } = params

        // Step 1: Validate parameters
        await this.validateTaskCreation(taskParams, context)

        // Step 2: Build complete task object
        const task = await this.buildTask(taskParams)

        // Step 3: Create feed data (if enabled)
        let feedData = null
        if (this.options.enableFeeds && feedUser) {
            try {
                feedData = await this.createTaskFeed('created', {
                    projectId: task.projectId || taskParams.projectId,
                    task,
                    taskId: task.id || taskParams.taskId,
                    feedUser,
                })
            } catch (feedError) {
                console.error('Feed creation failed:', feedError)
                // Continue without feed if it fails
            }
        }

        return {
            task,
            feedData,
            taskId: task.id || taskParams.taskId,
            success: true,
            message: `Task "${task.name}" created successfully`,
        }
    }

    /**
     * Persist task to database
     * @param {Object} taskResult - Result from createTask()
     * @param {Object} options - Persistence options
     * @returns {Promise} Persistence result
     */
    async persistTask(taskResult, options = {}) {
        await this.ensureInitialized()

        if (!this.options.database) {
            throw new Error('Database interface not configured')
        }

        const { task, feedData, taskId } = taskResult
        const { projectId, batch: externalBatch } = options

        const finalProjectId = projectId || task.projectId
        if (!finalProjectId) {
            throw new Error('Project ID is required for task persistence')
        }

        try {
            // Use external batch if provided, or create new one
            const batch =
                externalBatch ||
                (this.options.batchWrapper ? new this.options.batchWrapper(this.options.database) : null)

            if (!batch && !externalBatch) {
                // Direct write if no batch support
                const taskRef = this.options.database.collection(`items/${finalProjectId}/tasks`).doc(taskId)

                await taskRef.set(task)
            } else {
                // Batch write
                const taskRef = this.options.database.collection(`items/${finalProjectId}/tasks`).doc(taskId)

                batch.set ? batch.set(taskRef, task) : batch.add(() => taskRef.set(task))

                // Add feed data to batch if available
                if (feedData && this.options.enableFeeds) {
                    // The actual feed persistence would depend on the specific
                    // feed system implementation in each environment
                    if (batch.feedObjects) {
                        batch.feedObjects[taskId] = feedData.taskFeedObject
                    }
                }

                // Commit batch if we created it
                if (!externalBatch && batch.commit) {
                    await batch.commit()
                }
            }

            return {
                ...taskResult,
                persisted: true,
                projectId: finalProjectId,
            }
        } catch (error) {
            console.error('Task persistence failed:', error)
            throw new Error(`Failed to persist task: ${error.message}`)
        }
    }

    /**
     * Complete task creation with persistence
     * @param {Object} params - Task creation parameters
     * @param {Object} context - Creation context
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Complete creation result
     */
    async createAndPersistTask(params, context = {}, options = {}) {
        const taskResult = await this.createTask(params, context)
        return await this.persistTask(taskResult, options)
    }

    /**
     * Update task service configuration
     * @param {Object} newOptions - New configuration options
     */
    updateConfig(newOptions) {
        this.options = { ...this.options, ...newOptions }
    }

    /**
     * Get service configuration
     * @returns {Object} Current configuration
     */
    getConfig() {
        return { ...this.options }
    }

    /**
     * Health check for the service
     * @returns {Object} Service status
     */
    async healthCheck() {
        try {
            await this.ensureInitialized()
            return {
                status: 'healthy',
                initialized: this.initialized,
                dependencies: {
                    TaskModelBuilder: !!TaskModelBuilder,
                    TaskValidator: !!TaskValidator,
                    TaskFeedGenerator: !!TaskFeedGenerator,
                },
                config: {
                    database: !!this.options.database,
                    enableFeeds: this.options.enableFeeds,
                    enableValidation: this.options.enableValidation,
                    environment: this.options.isCloudFunction
                        ? 'cloud-function'
                        : this.options.isReactNative
                        ? 'react-native'
                        : this.options.isWeb
                        ? 'web'
                        : 'unknown',
                },
            }
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                initialized: this.initialized,
            }
        }
    }
}

// Universal export that works with both CommonJS and ES6 environments
export { TaskService }
export default TaskService

// Also provide CommonJS export for Node.js/Cloud Functions compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaskService
    module.exports.TaskService = TaskService
    module.exports.default = TaskService
}
