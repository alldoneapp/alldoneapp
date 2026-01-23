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
let TaskModelBuilder, TaskValidator, TaskFeedGenerator, getNextTaskId

// Dynamic imports for cross-platform compatibility
async function loadDependencies() {
    if (!TaskModelBuilder) {
        try {
            // Try CommonJS first (Node.js/Cloud Functions)
            if (typeof require !== 'undefined') {
                TaskModelBuilder = require('./TaskModelBuilder')
                TaskValidator = require('./TaskValidator')
                TaskFeedGenerator = require('./TaskFeedGenerator')
                // Import getNextTaskId for human readable ID generation
                try {
                    const taskIdGenerator = require('./taskIdGenerator')
                    getNextTaskId = taskIdGenerator.getNextTaskId
                } catch (error) {
                    console.warn('TaskService: Failed to load getNextTaskId function:', error.message)
                    getNextTaskId = null
                }
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
                // Try to import getNextTaskId for React Native/Web
                try {
                    // In React Native/Web environment, try the original path first
                    const projectsFirestore = await import('../../utils/backends/Projects/projectsFirestore')
                    getNextTaskId = projectsFirestore.getNextTaskId
                } catch (error) {
                    // Fallback to Cloud Functions version
                    try {
                        const taskIdGenerator = await import('./taskIdGenerator')
                        getNextTaskId = taskIdGenerator.getNextTaskId
                    } catch (fallbackError) {
                        console.warn('TaskService: Failed to load getNextTaskId function:', fallbackError.message)
                        getNextTaskId = null
                    }
                }
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
        this.focusTaskService = null
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

        // Validate generated task ID
        if (!taskId || typeof taskId !== 'string' || taskId.trim() === '') {
            throw new Error(`Failed to generate valid task ID: "${taskId}"`)
        }

        // Human readable ID will be generated asynchronously in onCreate trigger
        // This improves task creation performance by removing the blocking transaction
        let humanReadableId = params.humanReadableId || null
        // Only generate synchronously if explicitly provided humanReadableId
        // Otherwise, let the onCreate trigger handle it in background

        const task = TaskModelBuilder.createTaskObject({
            ...params,
            taskId,
            now,
            humanReadableId,
            moment: this.options.moment,
        })

        // Double-check the task has the ID field
        if (!task.id) {
            console.error('TaskService buildTask error: task object missing id field', {
                taskId,
                task_keys: Object.keys(task).slice(0, 10),
            })
            throw new Error('Task object is missing id field after creation')
        }

        return task
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
                    taskId: task.id,
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
            taskId: task.id,
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
        const { projectId, batch: externalBatch, feedUser } = options

        const finalProjectId = projectId || task.projectId
        if (!finalProjectId) {
            throw new Error('Project ID is required for task persistence')
        }

        // Validate task ID
        if (!taskId || typeof taskId !== 'string' || taskId.trim() === '') {
            console.error('TaskService persistence error: invalid taskId', {
                taskId,
                taskResultKeys: Object.keys(taskResult),
                taskId_from_result: taskResult.taskId,
                taskId_from_task: task.id,
                task_keys: task ? Object.keys(task).slice(0, 10) : 'no task',
            })
            throw new Error(`Invalid task ID for persistence: "${taskId}". Task ID must be a non-empty string.`)
        }

        try {
            // Use external batch if provided, or create new one
            const batch =
                externalBatch ||
                (this.options.batchWrapper ? new this.options.batchWrapper(this.options.database) : null)

            if (!batch && !externalBatch) {
                // Direct write if no batch support
                const taskRef = this.options.database.collection(`items/${finalProjectId}/tasks`).doc(taskId)

                // Normalize estimations for cross-environment compatibility
                const taskToPersist = (() => {
                    try {
                        const estimations = task && task.estimations ? { ...task.estimations } : {}
                        const openKeyValue = estimations['Open']
                        const numericKeyValue = estimations['-1']
                        const baseOpenValue =
                            typeof numericKeyValue === 'number'
                                ? numericKeyValue
                                : typeof openKeyValue === 'number'
                                ? openKeyValue
                                : 0
                        if (estimations['Open'] === undefined) estimations['Open'] = baseOpenValue
                        if (estimations['-1'] === undefined) estimations['-1'] = baseOpenValue
                        return { ...task, estimations }
                    } catch (_) {
                        return task
                    }
                })()

                await taskRef.set(taskToPersist)

                // Persist feeds using Cloud Functions feeds pipeline when available
                if (feedData && this.options.enableFeeds) {
                    if (this.options.isCloudFunction) {
                        try {
                            const admin = require('firebase-admin')
                            const { loadFeedsGlobalState } = require('../GlobalState/globalState')
                            const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
                            const feedsTasks = require('../Feeds/tasksFeeds')
                            if (feedsTasks && typeof feedsTasks.createTaskCreatedFeed === 'function') {
                                const feedsBatch = new BatchWrapper(this.options.database)
                                if (feedsBatch.setProjectContext) {
                                    feedsBatch.setProjectContext(finalProjectId)
                                }
                                const creator = feedUser || { uid: task.userId, id: task.userId }
                                // Load minimal global state required by feeds helpers (feedCreator and project)
                                let projectUsersIds = []
                                try {
                                    const projectSnap = await this.options.database
                                        .doc(`projects/${finalProjectId}`)
                                        .get()
                                    const projectData = projectSnap.exists ? projectSnap.data() : { userIds: [] }
                                    projectUsersIds = Array.isArray(projectData.userIds) ? projectData.userIds : []
                                    loadFeedsGlobalState(
                                        admin,
                                        admin,
                                        creator,
                                        { ...projectData, id: finalProjectId },
                                        [],
                                        null
                                    )
                                } catch (_) {}
                                // Normalize estimations so CF feeds helper (OPEN_STEP = -1) gets a defined value
                                const normalizedTaskForFeeds = (() => {
                                    try {
                                        const estimations =
                                            task && task.estimations ? { ...task.estimations } : { Open: 0 }
                                        if (estimations['-1'] === undefined) {
                                            const openValue = estimations['Open']
                                            estimations['-1'] = typeof openValue === 'number' ? openValue : 0
                                        }
                                        return { ...task, estimations }
                                    } catch (_) {
                                        return task
                                    }
                                })()
                                // Prepare initial followers: creator + assignees + observers (dedup)
                                const creatorId = creator.uid || task.userId
                                const assigneeIds = Array.isArray(task.userIds)
                                    ? task.userIds
                                    : [task.userId].filter(Boolean)
                                const observerIds = Array.isArray(task.observersIds) ? task.observersIds : []
                                const followerSet = new Set([creatorId, ...assigneeIds, ...observerIds].filter(Boolean))
                                const initialFollowers = Array.from(followerSet)
                                // Make followers available to feeds helper chain
                                feedsBatch.feedChainFollowersIds = {
                                    ...(feedsBatch.feedChainFollowersIds || {}),
                                    [taskId]: initialFollowers,
                                }
                                await feedsTasks.createTaskCreatedFeed(
                                    finalProjectId,
                                    normalizedTaskForFeeds,
                                    taskId,
                                    feedsBatch,
                                    creator,
                                    true,
                                    { feedCreator: creator, project: { id: finalProjectId, userIds: projectUsersIds } }
                                )
                                // Create follow feeds for each follower (dedup); creator will also get a follow feed unless duplicates collapse
                                for (const followerId of initialFollowers) {
                                    const followerUser = { uid: followerId, id: followerId }
                                    await feedsTasks.createTaskFollowedFeed(
                                        finalProjectId,
                                        taskId,
                                        feedsBatch,
                                        followerUser,
                                        true,
                                        {
                                            feedCreator: creator,
                                            project: { id: finalProjectId, userIds: projectUsersIds },
                                        }
                                    )
                                }
                                // Pre-commit cleanup: trim feedsCount documents to prevent index limit errors
                                try {
                                    const { cleanGlobalFeeds } = require('../Feeds/globalFeedsHelper')
                                    if (cleanGlobalFeeds) {
                                        await cleanGlobalFeeds(finalProjectId)
                                    }
                                } catch (cleanError) {
                                    console.warn('TaskService: Pre-commit feed cleanup failed:', cleanError.message)
                                }
                                if (feedsBatch.commit) {
                                    await feedsBatch.commit()
                                }
                            } else {
                                console.warn('TaskService: Feeds module missing createTaskCreatedFeed function')
                            }
                        } catch (feedPersistError) {
                            console.error('TaskService: Failed to persist feeds via pipeline:', feedPersistError)
                            // Fallback: persist last state only
                            try {
                                const feedObjectRef = this.options.database.doc(
                                    `feedsObjectsLastStates/${finalProjectId}/tasks/${taskId}`
                                )
                                await feedObjectRef.set(feedData.taskFeedObject, { merge: true })
                            } catch (fallbackError) {
                                console.error('Failed to persist feed object as fallback:', fallbackError)
                            }
                        }
                    } else {
                        // Non-cloud environments: persist last state only
                        try {
                            const feedObjectRef = this.options.database.doc(
                                `feedsObjectsLastStates/${finalProjectId}/tasks/${taskId}`
                            )
                            await feedObjectRef.set(feedData.taskFeedObject, { merge: true })
                        } catch (feedError) {
                            console.error('Failed to persist feed object directly:', feedError)
                        }
                    }
                }
            } else {
                // Batch write
                const taskRef = this.options.database.collection(`items/${finalProjectId}/tasks`).doc(taskId)

                // Normalize estimations for cross-environment compatibility
                const taskToPersist = (() => {
                    try {
                        const estimations = task && task.estimations ? { ...task.estimations } : {}
                        const openKeyValue = estimations['Open']
                        const numericKeyValue = estimations['-1']
                        const baseOpenValue =
                            typeof numericKeyValue === 'number'
                                ? numericKeyValue
                                : typeof openKeyValue === 'number'
                                ? openKeyValue
                                : 0
                        if (estimations['Open'] === undefined) estimations['Open'] = baseOpenValue
                        if (estimations['-1'] === undefined) estimations['-1'] = baseOpenValue
                        return { ...task, estimations }
                    } catch (_) {
                        return task
                    }
                })()

                batch.set ? batch.set(taskRef, taskToPersist) : batch.add(() => taskRef.set(taskToPersist))

                // Add feed data to batch if available
                if (feedData && this.options.enableFeeds) {
                    console.log('TaskService: Adding feed data to batch for task:', taskId)
                    if (batch.feedObjects) {
                        // Store feed data with context needed for persistence
                        batch.feedObjects[taskId] = {
                            feedObject: feedData.taskFeedObject,
                            projectId: finalProjectId,
                            objectType: 'tasks',
                            currentDateFormated: feedData.currentDateFormated,
                        }
                        console.log('TaskService: Successfully added feed data to batch.feedObjects')
                    } else {
                        console.warn('TaskService: batch.feedObjects is not available')
                    }

                    // In Cloud Functions, also push through feeds pipeline to generate inner feeds
                    if (this.options.isCloudFunction) {
                        try {
                            const admin = require('firebase-admin')
                            const { loadFeedsGlobalState } = require('../GlobalState/globalState')
                            const feedsTasks = require('../Feeds/tasksFeeds')
                            if (feedsTasks && typeof feedsTasks.createTaskCreatedFeed === 'function') {
                                const creator = feedUser || { uid: task.userId, id: task.userId }
                                // Load minimal global state required by feeds helpers (feedCreator and project)
                                let projectUsersIds = []
                                try {
                                    const projectSnap = await this.options.database
                                        .doc(`projects/${finalProjectId}`)
                                        .get()
                                    const projectData = projectSnap.exists ? projectSnap.data() : { userIds: [] }
                                    projectUsersIds = Array.isArray(projectData.userIds) ? projectData.userIds : []
                                    loadFeedsGlobalState(
                                        admin,
                                        admin,
                                        creator,
                                        { ...projectData, id: finalProjectId },
                                        [],
                                        null
                                    )
                                } catch (_) {}
                                // Normalize estimations so CF feeds helper (OPEN_STEP = -1) gets a defined value
                                const normalizedTaskForFeeds = (() => {
                                    try {
                                        const estimations =
                                            task && task.estimations ? { ...task.estimations } : { Open: 0 }
                                        if (estimations['-1'] === undefined) {
                                            const openValue = estimations['Open']
                                            estimations['-1'] = typeof openValue === 'number' ? openValue : 0
                                        }
                                        return { ...task, estimations }
                                    } catch (_) {
                                        return task
                                    }
                                })()
                                // Prepare initial followers: creator + assignees + observers (dedup)
                                const creatorId = creator.uid || task.userId
                                const assigneeIds = Array.isArray(task.userIds)
                                    ? task.userIds
                                    : [task.userId].filter(Boolean)
                                const observerIds = Array.isArray(task.observersIds) ? task.observersIds : []
                                const followerSet = new Set([creatorId, ...assigneeIds, ...observerIds].filter(Boolean))
                                const initialFollowers = Array.from(followerSet)
                                // Make followers available to feeds helper chain
                                batch.feedChainFollowersIds = {
                                    ...(batch.feedChainFollowersIds || {}),
                                    [taskId]: initialFollowers,
                                }
                                await feedsTasks.createTaskCreatedFeed(
                                    finalProjectId,
                                    normalizedTaskForFeeds,
                                    taskId,
                                    batch,
                                    creator,
                                    true,
                                    { feedCreator: creator, project: { id: finalProjectId, userIds: projectUsersIds } }
                                )
                                // Create follow feeds for each follower (dedup)
                                for (const followerId of initialFollowers) {
                                    const followerUser = { uid: followerId, id: followerId }
                                    await feedsTasks.createTaskFollowedFeed(
                                        finalProjectId,
                                        taskId,
                                        batch,
                                        followerUser,
                                        true,
                                        {
                                            feedCreator: creator,
                                            project: { id: finalProjectId, userIds: projectUsersIds },
                                        }
                                    )
                                }
                            } else {
                                console.warn('TaskService: Feeds module missing createTaskCreatedFeed function (batch)')
                            }
                        } catch (feedPersistError) {
                            console.error(
                                'TaskService: Failed to enqueue feeds via pipeline (batch):',
                                feedPersistError
                            )
                        }
                    }
                } else {
                    console.log('TaskService: Not adding feed data:', {
                        hasFeedData: !!feedData,
                        enableFeeds: this.options.enableFeeds,
                        taskId,
                    })
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

        // Ensure projectId is available for persistence
        const persistOptions = {
            ...options,
            projectId: options.projectId || params.projectId || context.projectId,
            // Pass feedUser forward so persistence can generate inner feeds in CF
            feedUser: params.feedUser,
        }

        return await this.persistTask(taskResult, persistOptions)
    }

    /**
     * Update an existing task with feed generation
     * @param {Object} params - Task update parameters
     * @param {string} params.taskId - Task ID to update (required)
     * @param {string} params.projectId - Project ID (required)
     * @param {Object} params.currentTask - Current task object (required)
     * @param {string} params.name - New task name (optional)
     * @param {string} params.description - New description (optional)
     * @param {number} params.dueDate - New due date timestamp (optional)
     * @param {boolean} params.completed - Completion status (optional)
     * @param {string} params.userId - New assigned user ID (optional)
     * @param {string} params.parentId - New parent task ID (optional)
     * @param {Object} params.feedUser - User object for feed creation
     * @param {Object} context - Additional context
     * @returns {Object} Complete task update result
     */
    async updateTask(params, context = {}) {
        await this.ensureInitialized()

        const {
            taskId,
            projectId,
            currentTask,
            name,
            description,
            dueDate,
            completed,
            userId,
            parentId,
            feedUser,
            focus,
            focusUserId,
            ...otherParams
        } = params

        // Validate required parameters
        if (!taskId || typeof taskId !== 'string') {
            throw new Error('Task ID is required for updates')
        }
        if (!projectId || typeof projectId !== 'string') {
            throw new Error('Project ID is required for updates')
        }
        if (!currentTask || typeof currentTask !== 'object') {
            throw new Error('Current task object is required for updates')
        }

        // Build update object with only provided fields
        const updateData = {}
        const changes = []

        if (name !== undefined) {
            updateData.name = String(name)
            updateData.extendedName = String(name) // Alldone requires both fields
            changes.push(`name to "${name}"`)
        }
        if (description !== undefined) {
            updateData.description = String(description)
            changes.push('description')
        }
        if (dueDate !== undefined) {
            updateData.dueDate = dueDate
            changes.push('due date')
        }
        if (userId !== undefined) {
            updateData.userId = String(userId)
            changes.push(`assigned to ${userId}`)
        }
        if (parentId !== undefined) {
            updateData.parentId = parentId
            changes.push('parent task')
        }

        // Handle completion status
        if (completed !== undefined) {
            const isCompleted = !!completed
            updateData.done = isCompleted
            updateData.inDone = isCompleted
            if (isCompleted) {
                updateData.completed = Date.now()
                updateData.completedDate = Date.now()
                updateData.completedTime = new Date().toTimeString().substring(0, 5)
                updateData.currentReviewerId = 'Done'
                changes.push('marked as complete')
            } else {
                updateData.completed = null
                updateData.completedDate = null
                updateData.completedTime = null
                updateData.currentReviewerId = currentTask.userId || updateData.userId || 'Open'
                changes.push('marked as incomplete')
            }
        }

        // Apply other update parameters
        Object.keys(otherParams).forEach(key => {
            if (otherParams[key] !== undefined) {
                updateData[key] = otherParams[key]
                changes.push(key)
            }
        })

        // Create updated task object for feed generation
        const updatedTask = { ...currentTask, ...updateData }

        let focusAction = null
        if (focus !== undefined) {
            const focusEnabled =
                typeof focus === 'string' ? focus.toLowerCase() === 'true' : focus === true || focus === 1
            const effectiveFocusUserId =
                focusUserId || context.focusUserId || (feedUser && (feedUser.uid || feedUser.id)) || userId

            if (!effectiveFocusUserId || typeof effectiveFocusUserId !== 'string') {
                throw new Error('A valid focus user ID is required to modify focus state')
            }

            const normalizedFocusAssignee = updateData.userId || currentTask.userId || updatedTask.userId
            const normalizedUserIds = Array.isArray(updatedTask.userIds) ? updatedTask.userIds : []

            if (
                focusEnabled &&
                normalizedFocusAssignee &&
                normalizedFocusAssignee !== effectiveFocusUserId &&
                !normalizedUserIds.includes(effectiveFocusUserId)
            ) {
                throw new Error('Cannot set focus task for a user who is not assigned to this task')
            }

            if (focusEnabled) {
                changes.push('set as focus task')
                focusAction = {
                    type: 'set',
                    userId: effectiveFocusUserId,
                    preserveDueDate: updateData.dueDate !== undefined,
                }
            } else {
                changes.push('removed from focus')
                focusAction = {
                    type: 'clear',
                    userId: effectiveFocusUserId,
                }
            }
        }

        // Generate feed data if enabled and feedUser provided
        let feedData = null
        if (this.options.enableFeeds && feedUser && changes.length > 0) {
            try {
                console.log('TaskService: Generating update feeds for task:', {
                    taskId,
                    projectId,
                    changes,
                    enableFeeds: this.options.enableFeeds,
                    hasFeedUser: !!feedUser,
                })
                // Generate entry text based on changes
                let entryText = 'updated task'
                if (changes.length > 0) {
                    if (changes.length === 1) {
                        entryText = changes[0].includes('marked as')
                            ? changes[0]
                            : `updated task ${changes[0].split(' ')[0]}`
                    } else {
                        const changeTypes = changes.map(c => c.split(' ')[0]).join(', ')
                        entryText = `updated task (${changeTypes})`
                    }
                }

                // Get existing task feed object for visibility/followers
                let taskFeedObject = null
                if (this.options.database) {
                    try {
                        const feedObjectRef = this.options.database.doc(
                            `feedsObjectsLastStates/${projectId}/tasks/${taskId}`
                        )
                        const feedObjectSnap = await feedObjectRef.get()
                        if (feedObjectSnap.exists) {
                            taskFeedObject = feedObjectSnap.data()
                        }
                    } catch (error) {
                        console.warn('TaskService: Could not retrieve existing feed object:', error.message)
                    }
                }

                // If no existing feed object, create a basic one
                if (!taskFeedObject) {
                    const { generateTaskObjectModel } = TaskFeedGenerator
                    taskFeedObject = generateTaskObjectModel(Date.now(), updatedTask, taskId)
                    taskFeedObject.isPublicFor = [TaskFeedGenerator.FEED_PUBLIC_FOR_ALL]
                }

                feedData = await this.createTaskFeed('updated', {
                    projectId,
                    taskId,
                    feedUser,
                    taskFeedObject,
                    updateType: undefined, // Use default FEED_TASK_UPDATED
                    entryText,
                })

                console.log('TaskService: Successfully created update feed data:', {
                    hasFeedData: !!feedData,
                    feedId: feedData?.feedId,
                    entryText: feedData?.feed?.entryText,
                })
            } catch (feedError) {
                console.error('TaskService: Feed creation failed for task update:', feedError)
                // Continue without feed if it fails
            }
        } else {
            console.log('TaskService: Skipping feed generation for update:', {
                enableFeeds: this.options.enableFeeds,
                hasFeedUser: !!feedUser,
                changesCount: changes.length,
            })
        }

        return {
            updateData,
            updatedTask,
            feedData,
            taskId,
            focusAction,
            changes,
            success: true,
            message:
                changes.length > 0
                    ? `Task "${currentTask.name}" updated successfully (${changes.join(', ')})`
                    : `Task "${currentTask.name}" processed (no changes made)`,
        }
    }

    /**
     * Persist task update to database with feed generation
     * @param {Object} updateResult - Result from updateTask()
     * @param {Object} options - Persistence options
     * @returns {Promise} Persistence result
     */
    async persistTaskUpdate(updateResult, options = {}) {
        await this.ensureInitialized()

        if (!this.options.database) {
            throw new Error('Database interface not configured')
        }

        const { updateData, updatedTask, feedData, taskId, focusAction } = updateResult
        const { projectId, batch: externalBatch, feedUser } = options

        const finalProjectId = projectId || updatedTask.projectId
        if (!finalProjectId) {
            throw new Error('Project ID is required for task update persistence')
        }

        // Validate task ID
        if (!taskId || typeof taskId !== 'string' || taskId.trim() === '') {
            console.error('TaskService update persistence error: invalid taskId', {
                taskId,
                updateResultKeys: Object.keys(updateResult),
                updatedTask_keys: updatedTask ? Object.keys(updatedTask).slice(0, 10) : 'no task',
            })
            throw new Error(`Invalid task ID for update persistence: "${taskId}". Task ID must be a non-empty string.`)
        }

        try {
            // Use external batch if provided, or create new one
            const batch =
                externalBatch ||
                (this.options.batchWrapper ? new this.options.batchWrapper(this.options.database) : null)

            if (!batch && !externalBatch) {
                // Direct write if no batch support
                const taskRef = this.options.database.collection(`items/${finalProjectId}/tasks`).doc(taskId)

                // Only update if there are actual changes
                if (Object.keys(updateData).length > 0) {
                    // Normalize estimations for cross-environment compatibility
                    const updateDataToApply = (() => {
                        try {
                            const normalizedUpdate = { ...updateData }
                            if (normalizedUpdate.estimations) {
                                const estimations = { ...normalizedUpdate.estimations }
                                const openKeyValue = estimations['Open']
                                const numericKeyValue = estimations['-1']
                                const baseOpenValue =
                                    typeof numericKeyValue === 'number'
                                        ? numericKeyValue
                                        : typeof openKeyValue === 'number'
                                        ? openKeyValue
                                        : 0
                                if (estimations['Open'] === undefined) estimations['Open'] = baseOpenValue
                                if (estimations['-1'] === undefined) estimations['-1'] = baseOpenValue
                                normalizedUpdate.estimations = estimations
                            }
                            return normalizedUpdate
                        } catch (_) {
                            return updateData
                        }
                    })()

                    await taskRef.update(updateDataToApply)
                }

                // Persist feeds using Cloud Functions feeds pipeline when available
                if (feedData && this.options.enableFeeds) {
                    console.log('TaskService: Starting feed persistence for update (direct):', {
                        taskId,
                        projectId: finalProjectId,
                        isCloudFunction: this.options.isCloudFunction,
                        hasFeedData: !!feedData,
                    })
                    if (this.options.isCloudFunction) {
                        try {
                            const admin = require('firebase-admin')
                            const { loadFeedsGlobalState } = require('../GlobalState/globalState')
                            const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
                            const feedsTasks = require('../Feeds/tasksFeeds')
                            if (feedsTasks && typeof feedsTasks.createTaskUpdatedFeed === 'function') {
                                const feedsBatch = new BatchWrapper(this.options.database)
                                if (feedsBatch.setProjectContext) {
                                    feedsBatch.setProjectContext(finalProjectId)
                                }
                                const creator = feedUser || { uid: updatedTask.userId, id: updatedTask.userId }
                                // Load minimal global state required by feeds helpers
                                let projectUsersIds = []
                                try {
                                    const projectSnap = await this.options.database
                                        .doc(`projects/${finalProjectId}`)
                                        .get()
                                    const projectData = projectSnap.exists ? projectSnap.data() : { userIds: [] }
                                    projectUsersIds = Array.isArray(projectData.userIds) ? projectData.userIds : []
                                    loadFeedsGlobalState(
                                        admin,
                                        admin,
                                        creator,
                                        { ...projectData, id: finalProjectId },
                                        [],
                                        null
                                    )
                                } catch (_) {}
                                // Normalize estimations so CF feeds helper gets proper values
                                const normalizedTaskForFeeds = (() => {
                                    try {
                                        const estimations =
                                            updatedTask && updatedTask.estimations
                                                ? { ...updatedTask.estimations }
                                                : { Open: 0 }
                                        if (estimations['-1'] === undefined) {
                                            const openValue = estimations['Open']
                                            estimations['-1'] = typeof openValue === 'number' ? openValue : 0
                                        }
                                        return { ...updatedTask, estimations }
                                    } catch (_) {
                                        return updatedTask
                                    }
                                })()
                                await feedsTasks.createTaskUpdatedFeed(
                                    finalProjectId,
                                    normalizedTaskForFeeds,
                                    taskId,
                                    feedsBatch,
                                    creator,
                                    true,
                                    {
                                        feedCreator: creator,
                                        project: { id: finalProjectId, userIds: projectUsersIds },
                                        entryText: feedData.feed.entryText,
                                    }
                                )
                                // Pre-commit cleanup: trim feedsCount documents to prevent index limit errors
                                try {
                                    const { cleanGlobalFeeds } = require('../Feeds/globalFeedsHelper')
                                    if (cleanGlobalFeeds) {
                                        await cleanGlobalFeeds(finalProjectId)
                                    }
                                } catch (cleanError) {
                                    console.warn('TaskService: Pre-commit feed cleanup failed:', cleanError.message)
                                }
                                if (feedsBatch.commit) {
                                    await feedsBatch.commit()
                                }
                            } else {
                                console.warn('TaskService: Feeds module missing createTaskUpdatedFeed function')
                                // Fallback: persist last state only
                                try {
                                    const feedObjectRef = this.options.database.doc(
                                        `feedsObjectsLastStates/${finalProjectId}/tasks/${taskId}`
                                    )
                                    await feedObjectRef.set(feedData.taskFeedObject, { merge: true })
                                } catch (fallbackError) {
                                    console.error('Failed to persist feed object as fallback:', fallbackError)
                                }
                            }
                        } catch (feedPersistError) {
                            console.error('TaskService: Failed to persist update feeds via pipeline:', feedPersistError)
                            // Fallback: persist last state only
                            try {
                                const feedObjectRef = this.options.database.doc(
                                    `feedsObjectsLastStates/${finalProjectId}/tasks/${taskId}`
                                )
                                await feedObjectRef.set(feedData.taskFeedObject, { merge: true })
                            } catch (fallbackError) {
                                console.error('Failed to persist feed object as fallback:', fallbackError)
                            }
                        }
                    } else {
                        // Non-cloud environments: persist last state only
                        try {
                            const feedObjectRef = this.options.database.doc(
                                `feedsObjectsLastStates/${finalProjectId}/tasks/${taskId}`
                            )
                            await feedObjectRef.set(feedData.taskFeedObject, { merge: true })
                        } catch (feedError) {
                            console.error('Failed to persist feed object directly:', feedError)
                        }
                    }
                }
            } else {
                // Batch write
                const taskRef = this.options.database.collection(`items/${finalProjectId}/tasks`).doc(taskId)

                // Only add to batch if there are actual changes
                if (Object.keys(updateData).length > 0) {
                    // Normalize estimations for cross-environment compatibility
                    const updateDataToApply = (() => {
                        try {
                            const normalizedUpdate = { ...updateData }
                            if (normalizedUpdate.estimations) {
                                const estimations = { ...normalizedUpdate.estimations }
                                const openKeyValue = estimations['Open']
                                const numericKeyValue = estimations['-1']
                                const baseOpenValue =
                                    typeof numericKeyValue === 'number'
                                        ? numericKeyValue
                                        : typeof openKeyValue === 'number'
                                        ? openKeyValue
                                        : 0
                                if (estimations['Open'] === undefined) estimations['Open'] = baseOpenValue
                                if (estimations['-1'] === undefined) estimations['-1'] = baseOpenValue
                                normalizedUpdate.estimations = estimations
                            }
                            return normalizedUpdate
                        } catch (_) {
                            return updateData
                        }
                    })()

                    batch.update
                        ? batch.update(taskRef, updateDataToApply)
                        : batch.add(() => taskRef.update(updateDataToApply))
                }

                // Add feed data to batch if available
                if (feedData && this.options.enableFeeds) {
                    console.log('TaskService: Starting feed persistence for update (batch):', {
                        taskId,
                        projectId: finalProjectId,
                        isCloudFunction: this.options.isCloudFunction,
                        hasFeedData: !!feedData,
                    })
                    console.log('TaskService: Adding update feed data to batch for task:', taskId)
                    if (batch.feedObjects) {
                        // Store feed data with context needed for persistence
                        batch.feedObjects[taskId] = {
                            feedObject: feedData.taskFeedObject,
                            projectId: finalProjectId,
                            objectType: 'tasks',
                            currentDateFormated: feedData.currentDateFormated,
                        }
                        console.log('TaskService: Successfully added update feed data to batch.feedObjects')
                    } else {
                        console.warn('TaskService: batch.feedObjects is not available for update feeds')
                    }

                    // In Cloud Functions, also push through feeds pipeline to generate inner feeds
                    if (this.options.isCloudFunction) {
                        try {
                            const admin = require('firebase-admin')
                            const { loadFeedsGlobalState } = require('../GlobalState/globalState')
                            const feedsTasks = require('../Feeds/tasksFeeds')
                            if (feedsTasks && typeof feedsTasks.createTaskUpdatedFeed === 'function') {
                                const creator = feedUser || { uid: updatedTask.userId, id: updatedTask.userId }
                                // Load minimal global state required by feeds helpers
                                let projectUsersIds = []
                                try {
                                    const projectSnap = await this.options.database
                                        .doc(`projects/${finalProjectId}`)
                                        .get()
                                    const projectData = projectSnap.exists ? projectSnap.data() : { userIds: [] }
                                    projectUsersIds = Array.isArray(projectData.userIds) ? projectData.userIds : []
                                    loadFeedsGlobalState(
                                        admin,
                                        admin,
                                        creator,
                                        { ...projectData, id: finalProjectId },
                                        [],
                                        null
                                    )
                                } catch (_) {}
                                // Normalize estimations so CF feeds helper gets proper values
                                const normalizedTaskForFeeds = (() => {
                                    try {
                                        const estimations =
                                            updatedTask && updatedTask.estimations
                                                ? { ...updatedTask.estimations }
                                                : { Open: 0 }
                                        if (estimations['-1'] === undefined) {
                                            const openValue = estimations['Open']
                                            estimations['-1'] = typeof openValue === 'number' ? openValue : 0
                                        }
                                        return { ...updatedTask, estimations }
                                    } catch (_) {
                                        return updatedTask
                                    }
                                })()
                                await feedsTasks.createTaskUpdatedFeed(
                                    finalProjectId,
                                    normalizedTaskForFeeds,
                                    taskId,
                                    batch,
                                    creator,
                                    true,
                                    {
                                        feedCreator: creator,
                                        project: { id: finalProjectId, userIds: projectUsersIds },
                                        entryText: feedData.feed.entryText,
                                    }
                                )
                            } else {
                                console.warn('TaskService: Feeds module missing createTaskUpdatedFeed function (batch)')
                            }
                        } catch (feedPersistError) {
                            console.error(
                                'TaskService: Failed to enqueue update feeds via pipeline (batch):',
                                feedPersistError
                            )
                        }
                    }
                } else {
                    console.log('TaskService: Not adding update feed data:', {
                        hasFeedData: !!feedData,
                        enableFeeds: this.options.enableFeeds,
                        taskId,
                    })
                }

                // Commit batch if we created it
                if (!externalBatch && batch.commit) {
                    await batch.commit()
                }
            }

            let focusResult = null
            if (focusAction && focusAction.userId) {
                try {
                    const focusTaskService = await this.getFocusTaskService()
                    if (focusAction.type === 'set') {
                        await focusTaskService.setNewFocusTask(
                            focusAction.userId,
                            finalProjectId,
                            { id: taskId, ...updatedTask },
                            { preserveDueDate: !!focusAction.preserveDueDate }
                        )
                        focusResult = { action: 'set', userId: focusAction.userId }
                    } else if (focusAction.type === 'clear') {
                        focusResult = await focusTaskService.clearFocusTask(focusAction.userId, taskId)
                    }
                } catch (focusError) {
                    console.error('TaskService: Focus update failed:', focusError)
                    throw new Error(`Failed to update focus task state: ${focusError.message}`)
                }
            }

            return {
                ...updateResult,
                persisted: true,
                projectId: finalProjectId,
                focusResult,
            }
        } catch (error) {
            console.error('Task update persistence failed:', error)
            throw new Error(`Failed to persist task update: ${error.message}`)
        }
    }

    async getFocusTaskService() {
        if (!this.focusTaskService) {
            const { FocusTaskService } = require('./FocusTaskService')
            const momentProvider = this.options.moment || require('moment')
            this.focusTaskService = new FocusTaskService({
                database: this.options.database,
                moment: momentProvider,
                isCloudFunction: this.options.isCloudFunction,
            })
            await this.focusTaskService.initialize()
        }
        return this.focusTaskService
    }

    /**
     * Complete task update with persistence
     * @param {Object} params - Task update parameters
     * @param {Object} context - Update context
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Complete update result
     */
    async updateAndPersistTask(params, context = {}, options = {}) {
        const updateResult = await this.updateTask(params, context)

        // Only persist if there are actual changes
        if (updateResult.changes.length > 0) {
            // Ensure projectId is available for persistence
            const persistOptions = {
                ...options,
                projectId: options.projectId || params.projectId || context.projectId,
                // Pass feedUser forward so persistence can generate inner feeds in CF
                feedUser: params.feedUser,
            }

            return await this.persistTaskUpdate(updateResult, persistOptions)
        }

        return {
            ...updateResult,
            persisted: false,
            message: updateResult.message + ' (no database changes needed)',
        }
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

// CommonJS export - works with Node.js and can be converted by bundlers
module.exports = {
    TaskService,
    default: TaskService,
}
