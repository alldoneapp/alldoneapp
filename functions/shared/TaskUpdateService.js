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
     * @param {Object} updateFields - Fields to update (name, description, completed, etc.)
     * @param {Object} options - Search options (autoSelectOnHighConfidence, thresholds, etc.)
     * @returns {Promise<Object>} Update result with success, message, and task data
     */
    async findAndUpdateTask(userId, searchCriteria, updateFields, options = {}) {
        if (!this.initialized) {
            throw new Error('TaskUpdateService not initialized. Call initialize() first.')
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
     * Perform the actual task update
     */
    async performTaskUpdate(currentTask, projectId, projectName, updateFields, userId, feedUser) {
        console.log('🔄 TaskUpdateService: Executing task update via TaskService')

        try {
            // Get user's timezone for date parsing
            const userDoc = await this.options.database.collection('users').doc(userId).get()
            const userData = userDoc.data()
            const timezoneOffset = userData?.timezone || 0 // Minutes from UTC

            console.log('🔄 TaskUpdateService: User timezone info', {
                userId,
                timezoneOffset,
                hasTimezone: !!userData?.timezone,
            })

            // Handle dueDate with timezone conversion if it's a string
            let processedDueDate = updateFields.dueDate
            if (updateFields.dueDate && typeof updateFields.dueDate === 'string') {
                console.log('🔄 TaskUpdateService: Processing dueDate ISO string with timezone', {
                    originalDueDate: updateFields.dueDate,
                    timezoneOffset,
                })

                // Parse ISO string in user's local timezone, convert to UTC timestamp
                processedDueDate = this.options.moment(updateFields.dueDate).utcOffset(timezoneOffset).valueOf()

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

            console.log('🔄 TaskUpdateService: Update successful', {
                taskId: currentTask.id,
                changes: result.changes,
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
                    // Import setTaskAlert function
                    const { setTaskAlert } = require('../../utils/backends/Tasks/tasksFirestore')

                    // Convert UTC timestamp to moment with user's timezone for setTaskAlert
                    const alertMoment = this.options.moment(finalDueDate).utcOffset(timezoneOffset)

                    console.log('🔄 TaskUpdateService: Calling setTaskAlert', {
                        taskId: currentTask.id,
                        projectId,
                        alertEnabled: updateFields.alertEnabled,
                        alertTime: alertMoment.format('YYYY-MM-DD HH:mm:ss'),
                        dueDate: finalDueDate,
                    })

                    // Call existing setTaskAlert function (handles feed generation)
                    await setTaskAlert(projectId, currentTask.id, updateFields.alertEnabled, alertMoment, {
                        ...currentTask,
                        dueDate: finalDueDate,
                    })

                    console.log('🔄 TaskUpdateService: Alert updated successfully')
                }
            }

            // Build success message
            const changes = result.changes || []
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
