/**
 * TaskUpdateService - Universal task update service with search
 *
 * This service provides a unified API for updating tasks by name/ID with intelligent search:
 * - MCP Server (Cloud Functions)
 * - Assistant Tool calls (Cloud Functions)
 * - Any other task update contexts
 *
 * Features:
 * - Search tasks by name, project, or ID
 * - Confidence-based auto-selection
 * - Present multiple options when ambiguous
 * - Consistent feed generation
 * - Comprehensive error handling
 */

// Import shared utilities
let TaskService, TaskSearchService, admin

// Dynamic imports for dependencies
async function loadDependencies() {
    if (!TaskService) {
        try {
            // CommonJS imports (Node.js/Cloud Functions)
            if (typeof require !== 'undefined') {
                // TaskService is exported as { TaskService }, need to destructure
                const taskServiceModule = require('./TaskService')
                TaskService = taskServiceModule.TaskService
                // TaskSearchService is exported directly
                TaskSearchService = require('./TaskSearchService')
                try {
                    admin = require('firebase-admin')
                } catch (e) {
                    console.warn('TaskUpdateService: firebase-admin not available')
                }
            }
        } catch (error) {
            console.error('Failed to load TaskUpdateService dependencies:', error)
            throw new Error('TaskUpdateService initialization failed')
        }
    }
}

class TaskUpdateService {
    constructor(options = {}) {
        this.options = {
            // Database interface (Firestore admin, client, etc.)
            database: null,

            // Moment.js instance for date handling
            moment: null,

            // Environment-specific options
            isCloudFunction: typeof process !== 'undefined' && process.env.FUNCTIONS_EMULATOR !== undefined,

            // Override any defaults
            ...options,
        }

        this.initialized = false
        this.taskService = null
        this.taskSearchService = null
    }

    /**
     * Initialize the service (load dependencies)
     */
    async initialize() {
        if (this.initialized) return

        await loadDependencies()

        // Initialize TaskSearchService
        this.taskSearchService = new TaskSearchService({
            database: this.options.database,
            isCloudFunction: this.options.isCloudFunction,
        })
        await this.taskSearchService.initialize()

        // Initialize TaskService
        this.taskService = new TaskService({
            database: this.options.database,
            moment: this.options.moment,
            isCloudFunction: this.options.isCloudFunction,
            enableFeeds: true,
            enableValidation: false, // We validate during search
        })
        await this.taskService.initialize()

        this.initialized = true
    }

    /**
     * Find and update a task with intelligent search
     * @param {string} userId - User ID performing the update
     * @param {Object} searchCriteria - Search criteria (taskId, taskName, projectName, etc.)
     * @param {Object} updateFields - Fields to update (name, description, completed, estimation, etc.)
     * @param {Object} options - Search options (autoSelectOnHighConfidence, thresholds, updateAll, etc.)
     * @returns {Promise<Object>} Update result with success, message, and task data
     */
    async findAndUpdateTask(userId, searchCriteria, updateFields, options = {}) {
        if (!this.initialized) {
            throw new Error('TaskUpdateService not initialized. Call initialize() first.')
        }

        // Check if this is a bulk update request
        if (options.updateAll === true) {
            console.log('🔄 TaskUpdateService: Bulk update requested')
            return await this.bulkUpdateTasks(userId, searchCriteria, updateFields, options)
        }

        const searchOptions = {
            autoSelectOnHighConfidence: options.autoSelectOnHighConfidence !== false,
            highConfidenceThreshold: options.highConfidenceThreshold || 800,
            dominanceMargin: options.dominanceMargin || 300,
            maxOptionsToShow: options.maxOptionsToShow || 5,
        }

        console.log('🔄 TaskUpdateService: Finding task with criteria', {
            userId,
            searchCriteria,
            searchOptions,
        })

        // Step 1: Task Discovery
        const searchResult = await this.taskSearchService.findTaskForUpdate(userId, searchCriteria, searchOptions)

        console.log('🔄 TaskUpdateService: Search result', {
            decision: searchResult.decision,
            confidence: searchResult.confidence,
            reasoning: searchResult.reasoning,
        })

        // Step 2: Handle decision outcomes
        if (searchResult.decision === 'no_matches') {
            console.error('🔄 TaskUpdateService: No tasks found')
            throw new Error(searchResult.error || 'No tasks found matching the search criteria')
        }

        if (searchResult.decision === 'present_options') {
            console.log('🔄 TaskUpdateService: Multiple matches, presenting options')
            return this.formatMultipleMatchesResponse(searchResult)
        }

        // Step 3: Proceed with auto-selected or single match
        const { task: currentTask, projectId, projectName } = searchResult.selectedMatch

        console.log('🔄 TaskUpdateService: Task found, proceeding with update', {
            taskId: currentTask.id,
            taskName: currentTask.name,
            projectId,
            projectName,
        })

        // Step 4: Get feedUser for feed generation
        const feedUser = await this.createFeedUserFromUserId(userId, this.options.database)

        // Step 5: Perform update
        const updateResult = await this.performTaskUpdate(
            currentTask,
            projectId,
            projectName,
            updateFields,
            userId,
            feedUser
        )

        // Add search transparency if auto-selected
        if (searchResult.decision === 'auto_select') {
            updateResult.searchInfo = {
                decision: searchResult.decision,
                confidence: searchResult.confidence,
                reasoning: searchResult.reasoning,
                alternativeMatches: searchResult.alternativeMatches?.length || 0,
            }
            updateResult.message += ` (${searchResult.reasoning})`
        }

        return updateResult
    }

    /**
     * Bulk update tasks across all projects or a specific project
     * Only updates today + overdue open tasks (safety measure)
     * @param {string} userId - User ID performing the update
     * @param {Object} searchCriteria - Search criteria (projectId optional for filtering)
     * @param {Object} updateFields - Fields to update (same as single update)
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Bulk update result with summary
     */
    async bulkUpdateTasks(userId, searchCriteria, updateFields, options = {}) {
        console.log('🔄🔄 TaskUpdateService: Starting bulk update', {
            userId,
            searchCriteria,
            updateFields,
        })

        const { projectId } = searchCriteria || {}

        // Determine scope: single project or all projects
        let projectIds = []
        let projectsData = {}

        if (projectId) {
            // Single project bulk update
            console.log(`🔄🔄 TaskUpdateService: Bulk update limited to project: ${projectId}`)
            projectIds = [projectId]

            // Get project data
            const projectDoc = await this.options.database.collection('projects').doc(projectId).get()
            if (!projectDoc.exists) {
                throw new Error(`Project not found: ${projectId}`)
            }
            const projectData = projectDoc.data()
            projectsData[projectId] = { name: projectData.name, description: projectData.description }
        } else {
            // All projects bulk update
            console.log('🔄🔄 TaskUpdateService: Bulk update across all user projects')
            const { ProjectService } = require('./ProjectService')
            const projectService = new ProjectService({ database: this.options.database })
            await projectService.initialize()

            const projects = await projectService.getUserProjects(userId, {
                includeArchived: false,
                includeCommunity: false,
            })
            projectIds = projects.map(p => p.id)
            projectsData = projects.reduce((acc, p) => {
                acc[p.id] = { name: p.name, description: p.description }
                return acc
            }, {})
        }

        // Query tasks (today + overdue only for safety)
        const { TaskRetrievalService } = require('./TaskRetrievalService')
        const retrievalService = new TaskRetrievalService({
            database: this.options.database,
            moment: this.options.moment,
            isCloudFunction: this.options.isCloudFunction,
        })
        await retrievalService.initialize()

        let result
        if (projectIds.length === 1) {
            // Single project query
            console.log('🔄🔄 TaskUpdateService: Querying single project for tasks')
            result = await retrievalService.getTasks({
                projectId: projectIds[0],
                userId,
                status: 'open',
                date: 'today', // Gets today + overdue
                limit: 100,
                selectMinimalFields: false, // Need full task for updates
            })
        } else {
            // Multi-project query
            console.log('🔄🔄 TaskUpdateService: Querying multiple projects for tasks')
            result = await retrievalService.getTasksFromMultipleProjects(
                {
                    userId,
                    status: 'open',
                    date: 'today',
                    perProjectLimit: 100,
                    selectMinimalFields: false,
                },
                projectIds,
                projectsData
            )
        }

        const tasks = result.tasks || []

        console.log('🔄🔄 TaskUpdateService: Tasks found for bulk update', {
            count: tasks.length,
            projectsQueried: projectIds.length,
        })

        // Safety check
        if (tasks.length > 100) {
            throw new Error(
                `Too many tasks match (${tasks.length}). Max 100 allowed for bulk updates. ` +
                    (projectId
                        ? `Try being more specific or updating in smaller batches.`
                        : `Try specifying a projectId to limit scope.`)
            )
        }

        if (tasks.length === 0) {
            return {
                success: true,
                updated: [],
                failed: [],
                total: 0,
                projectsQueried: projectIds.length,
                projectScope: projectId ? `Limited to project ${projectsData[projectId]?.name}` : 'All projects',
                message: 'No today/overdue tasks found to update',
            }
        }

        // Get feedUser once for all updates
        const feedUser = await this.createFeedUserFromUserId(userId, this.options.database)

        // Update each task
        const updated = []
        const failed = []

        for (const task of tasks) {
            try {
                // Ensure projectId is set on the task (single-project queries don't include it in the task object)
                const taskProjectId = task.projectId || (projectIds.length === 1 ? projectIds[0] : null)

                if (!taskProjectId) {
                    throw new Error('Unable to determine project ID for task')
                }

                const taskProjectName = projectsData[taskProjectId]?.name || 'Unknown'
                const updateResult = await this.performTaskUpdate(
                    task,
                    taskProjectId,
                    taskProjectName,
                    updateFields,
                    userId,
                    feedUser
                )
                updated.push({
                    id: task.id,
                    name: task.name,
                    projectId: taskProjectId,
                    projectName: taskProjectName,
                    changes: updateResult.changes,
                })
            } catch (error) {
                console.error('🔄🔄 TaskUpdateService: Failed to update task', {
                    taskId: task.id,
                    taskName: task.name,
                    error: error.message,
                })
                const taskProjectId = task.projectId || (projectIds.length === 1 ? projectIds[0] : null)
                failed.push({
                    id: task.id,
                    name: task.name,
                    projectId: taskProjectId,
                    error: error.message,
                })
            }
        }

        const successMessage =
            `Updated ${updated.length} of ${tasks.length} tasks` +
            (failed.length > 0 ? ` (${failed.length} failed)` : '')

        console.log('🔄🔄 TaskUpdateService: Bulk update complete', {
            total: tasks.length,
            updated: updated.length,
            failed: failed.length,
        })

        return {
            success: true,
            updated,
            failed,
            total: tasks.length,
            projectsQueried: projectIds.length,
            projectScope: projectId ? `Limited to project ${projectsData[projectId]?.name}` : 'All projects',
            message: successMessage,
        }
    }

    /**
     * Perform the actual task update
     */
    async performTaskUpdate(currentTask, projectId, projectName, updateFields, userId, feedUser) {
        console.log('🔄 TaskUpdateService: Executing task update via TaskService')

        try {
            // Get user's timezone for date parsing (normalize across possible fields)
            const userDoc = await this.options.database.collection('users').doc(userId).get()
            const userData = userDoc.data()
            let timezoneOffset = 0
            try {
                const { TaskRetrievalService } = require('./TaskRetrievalService')
                const rawTz =
                    (typeof userData?.timezone !== 'undefined' ? userData.timezone : null) ??
                    (typeof userData?.timezoneOffset !== 'undefined' ? userData.timezoneOffset : null) ??
                    (typeof userData?.timezoneMinutes !== 'undefined' ? userData.timezoneMinutes : null) ??
                    (typeof userData?.preferredTimezone !== 'undefined' ? userData.preferredTimezone : null)
                const normalized = TaskRetrievalService.normalizeTimezoneOffset(rawTz)
                timezoneOffset = typeof normalized === 'number' ? normalized : timezoneOffset
            } catch (_) {}

            console.log('🔄 TaskUpdateService: User timezone info', {
                userId,
                timezoneOffset,
                hasTimezone: !!userData?.timezone,
            })

            // Handle estimation update if provided
            if (updateFields.estimation !== undefined) {
                await this.performEstimationUpdate(projectId, currentTask.id, currentTask, updateFields.estimation)
            }

            // Handle dueDate with timezone conversion if it's a string
            let processedDueDate = updateFields.dueDate
            if (updateFields.dueDate && typeof updateFields.dueDate === 'string') {
                console.log('🔄 TaskUpdateService: Processing dueDate ISO string with timezone', {
                    originalDueDate: updateFields.dueDate,
                    timezoneOffset,
                })

                // Respect embedded timezone if present; otherwise interpret as user's local time
                const parsed = this.options.moment.parseZone(updateFields.dueDate)
                if (
                    parsed &&
                    parsed.isValid() &&
                    parsed.utcOffset() !== 0 &&
                    /[zZ]|[+-]\d{2}:?\d{2}$/.test(updateFields.dueDate)
                ) {
                    processedDueDate = parsed.valueOf()
                } else {
                    // Interpret provided local clock time in user's timezone and convert to UTC ms
                    processedDueDate = this.options
                        .moment(updateFields.dueDate)
                        .utcOffset(timezoneOffset, true)
                        .valueOf()
                }

                console.log('🔄 TaskUpdateService: Converted dueDate', {
                    from: updateFields.dueDate,
                    to: processedDueDate,
                    asDate: new Date(processedDueDate).toISOString(),
                })
            }

            const result = await this.taskService.updateAndPersistTask({
                taskId: currentTask.id,
                projectId: projectId,
                currentTask: currentTask,
                name: updateFields.name,
                description: updateFields.description,
                dueDate: processedDueDate,
                completed: updateFields.completed,
                userId: updateFields.userId || updateFields.targetUserId,
                parentId: updateFields.parentId,
                feedUser: feedUser,
                focus: updateFields.focus,
                focusUserId: userId,
            })

            // Add estimation to changes if it was updated
            const changes = result.changes || []
            if (updateFields.estimation !== undefined && !changes.includes('estimation')) {
                changes.push('estimation')
            }

            console.log('🔄 TaskUpdateService: Update successful', {
                taskId: currentTask.id,
                changes: changes,
                feedGenerated: !!result.feedData,
            })

            // Handle alert if alertEnabled parameter is provided
            if (updateFields.alertEnabled !== undefined) {
                console.log('🔄 TaskUpdateService: Processing alertEnabled', {
                    alertEnabled: updateFields.alertEnabled,
                    taskId: currentTask.id,
                })

                // Get the final dueDate (either newly set or existing)
                const finalDueDate = processedDueDate !== undefined ? processedDueDate : currentTask.dueDate

                // Validate: can't enable alert without dueDate
                if (updateFields.alertEnabled && !finalDueDate) {
                    throw new Error('Cannot enable alert without setting a due date/reminder time')
                }

                if (finalDueDate) {
                    // Import server-side alert updater
                    const { setTaskAlertCloud } = require('./AlertService')

                    // Convert UTC timestamp to moment with user's timezone for setTaskAlert
                    const alertMoment = this.options.moment(finalDueDate).utcOffset(timezoneOffset)

                    console.log('🔄 TaskUpdateService: Calling setTaskAlert', {
                        taskId: currentTask.id,
                        projectId,
                        alertEnabled: updateFields.alertEnabled,
                        alertTime: alertMoment.format('YYYY-MM-DD HH:mm:ss'),
                        dueDate: finalDueDate,
                    })

                    // Update alert server-side (Cloud)
                    await setTaskAlertCloud(projectId, currentTask.id, updateFields.alertEnabled, alertMoment, {
                        ...currentTask,
                        dueDate: finalDueDate,
                    })

                    console.log('🔄 TaskUpdateService: Alert updated successfully')
                }
            }

            // Build success message
            let message = `Task "${currentTask.name}" updated successfully`
            if (changes.length > 0) {
                message += ` (${changes.join(', ')})`
            }
            message += ` in project "${projectName}"`

            return {
                success: true,
                taskId: currentTask.id,
                message,
                task: result.updatedTask || { id: currentTask.id, ...currentTask },
                project: { id: projectId, name: projectName },
                changes: changes,
                focusResult: result.focusResult || null,
            }
        } catch (error) {
            console.error('🔄 TaskUpdateService: Update failed', {
                error: error.message,
                stack: error.stack,
            })
            throw new Error(`Failed to update task: ${error.message}`)
        }
    }

    /**
     * Update task estimation
     * @param {string} projectId - Project ID
     * @param {string} taskId - Task ID
     * @param {Object} task - Current task object
     * @param {number} estimationMinutes - Estimation value in minutes
     * @returns {Promise<Object>} Update result
     */
    async performEstimationUpdate(projectId, taskId, task, estimationMinutes) {
        console.log('🔄 TaskUpdateService: Updating task estimation', {
            projectId,
            taskId,
            estimationMinutes,
        })

        try {
            // Import the setTaskEstimations function from tasksFirestore
            const { setTaskEstimations } = require('../backends/Tasks/tasksFirestore')
            const { OPEN_STEP } = require('../../utils/TasksHelper')

            // Validate estimation is a number
            if (typeof estimationMinutes !== 'number' || estimationMinutes < 0) {
                throw new Error('Estimation must be a non-negative number in minutes')
            }

            // Call the existing backend function to update estimation
            await setTaskEstimations(
                projectId,
                taskId,
                task,
                OPEN_STEP, // Default workflow step (-1)
                estimationMinutes
            )

            console.log('🔄 TaskUpdateService: Estimation updated successfully', {
                taskId,
                newEstimation: estimationMinutes,
            })

            return { success: true }
        } catch (error) {
            console.error('🔄 TaskUpdateService: Estimation update failed', {
                error: error.message,
                stack: error.stack,
            })
            throw new Error(`Failed to update estimation: ${error.message}`)
        }
    }

    /**
     * Format multiple matches response with confidence information
     */
    formatMultipleMatchesResponse(searchResult) {
        const { allMatches, reasoning, confidence, totalMatches } = searchResult

        let message = `${reasoning}\n\nFound ${totalMatches || allMatches.length} tasks:\n\n`

        allMatches.slice(0, 5).forEach((match, index) => {
            message += `${index + 1}. "${match.task.name}"`

            // Show human readable ID if available
            if (match.task.humanReadableId) {
                message += ` (ID: ${match.task.humanReadableId})`
            }

            message += ` (Project: ${match.projectName})`

            // Show confidence indicators
            const matchConfidence = this.taskSearchService.assessConfidence(match.matchScore)
            message += ` [${matchConfidence} confidence: ${match.matchScore}]\n`

            if (match.task.description) {
                message += `   Description: ${match.task.description.substring(0, 100)}${
                    match.task.description.length > 100 ? '...' : ''
                }\n`
            }
            message += `   Task ID: ${match.task.id}\n\n`
        })

        if (allMatches.length > 5) {
            message += `... and ${allMatches.length - 5} more matches.\n\n`
        }

        message +=
            'Please be more specific in your search criteria, or use the exact task ID to update a specific task.'

        return {
            success: false,
            message,
            confidence,
            reasoning,
            matches: allMatches.map(m => ({
                taskId: m.task.id,
                taskName: m.task.name,
                humanReadableId: m.task.humanReadableId,
                projectId: m.projectId,
                projectName: m.projectName,
                matchScore: m.matchScore,
                matchType: m.matchType,
                confidence: this.taskSearchService.assessConfidence(m.matchScore),
            })),
            totalMatches: totalMatches || allMatches.length,
        }
    }

    /**
     * Create feedUser object from userId
     * @param {string} userId - User ID
     * @param {Object} db - Firestore database instance
     * @param {boolean} detailed - If true, fetch full user data; if false, use minimal
     * @returns {Promise<Object>} FeedUser object
     */
    async createFeedUserFromUserId(userId, db, detailed = false) {
        if (!detailed) {
            // Minimal feedUser for updates (TaskService will work with this)
            return { uid: userId, id: userId }
        }

        // Detailed feedUser with name and email (for better feed display)
        try {
            const userDoc = await db.collection('users').doc(userId).get()
            if (userDoc.exists) {
                const userData = userDoc.data()
                return {
                    uid: userId,
                    id: userId,
                    creatorId: userId,
                    name: userData.name || userData.displayName || 'User',
                    email: userData.email || '',
                }
            }
        } catch (error) {
            console.warn('Could not get user data for feedUser:', error.message)
        }

        // Fallback to minimal
        return { uid: userId, id: userId, creatorId: userId, name: 'User', email: '' }
    }
}

module.exports = TaskUpdateService
