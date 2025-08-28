/**
 * TaskRetrievalService - Universal task querying and retrieval service
 *
 * This service provides a unified API for task retrieval, filtering, and ranking
 * that works across all platforms and contexts:
 * - MCP Server (Cloud Functions)
 * - Assistant Tool calls (Cloud Functions)
 * - Frontend UI components (React Native/Web)
 * - Backend operations (Cloud Functions)
 * - Any other task retrieval contexts
 */

const moment = require('moment')

// Import constants that are used across different environments
const OPEN_STEP = 'Open'
const FEED_PUBLIC_FOR_ALL = 'FEED_PUBLIC_FOR_ALL'

class TaskRetrievalService {
    constructor(options = {}) {
        this.options = {
            // Database interface (Firestore admin, client, etc.)
            database: null,

            // Moment.js instance for date handling
            moment: moment,

            // Environment-specific options
            isCloudFunction: typeof process !== 'undefined' && process.env.FUNCTIONS_EMULATOR !== undefined,
            isReactNative: typeof navigator !== 'undefined' && navigator.product === 'ReactNative',
            isWeb: typeof window !== 'undefined',

            // Override any defaults
            ...options,
        }

        this.initialized = false
    }

    /**
     * Initialize the service
     */
    async initialize() {
        if (this.initialized) return

        if (!this.options.database) {
            throw new Error('Database interface is required for TaskRetrievalService')
        }

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
     * Build Firestore query for tasks based on parameters
     * @param {Object} params - Query parameters
     * @returns {Object} Firestore query
     */
    buildTaskQuery(params) {
        const {
            projectId,
            userId,
            status = 'open',
            date = null,
            includeSubtasks = false,
            parentId = null,
            limit = 20,
            userPermissions = [FEED_PUBLIC_FOR_ALL],
        } = params

        if (!projectId) {
            throw new Error('Project ID is required')
        }

        let query = this.options.database.collection(`items/${projectId}/tasks`)

        // Filter by user permissions
        if (userPermissions && userPermissions.length > 0) {
            query = query.where('isPublicFor', 'array-contains-any', userPermissions)
        }

        // Filter by subtasks
        if (parentId) {
            // Get specific parent's subtasks
            query = query.where('parentId', '==', parentId).where('isSubtask', '==', true)
        } else if (!includeSubtasks) {
            // Exclude subtasks (default behavior)
            query = query.where('isSubtask', '==', false)
        }

        // Filter by status
        if (status === 'open') {
            query = query.where('done', '==', false).where('inDone', '==', false)
        } else if (status === 'done') {
            query = query.where('done', '==', true).where('inDone', '==', true)
        }
        // status === 'all' means no status filtering

        // Date filtering
        if (date && status !== 'all') {
            const dateFilters = this.buildDateFilters(date, status)
            if (dateFilters.field && dateFilters.operator && dateFilters.value !== null) {
                if (dateFilters.operator === 'range') {
                    // For range queries (specific date)
                    query = query
                        .where(dateFilters.field, '>=', dateFilters.value.start)
                        .where(dateFilters.field, '<=', dateFilters.value.end)
                } else {
                    query = query.where(dateFilters.field, dateFilters.operator, dateFilters.value)
                }
            }
        }

        // Ordering - matches main app patterns
        if (status === 'done') {
            // For done tasks: order by completion date first, then sortIndex
            query = query.orderBy('completed', 'desc').orderBy('sortIndex', 'desc')
        } else {
            // For open tasks: order by sortIndex (creation/priority order)
            query = query.orderBy('sortIndex', 'desc')
        }

        // Apply limit
        if (limit && limit > 0) {
            query = query.limit(Math.min(limit, 200)) // Cap at 200 for performance
        }

        return query
    }

    /**
     * Build date filters based on date parameter and status
     * @param {string} date - Date filter ('today' or 'YYYY-MM-DD')
     * @param {string} status - Task status ('open', 'done', 'all')
     * @returns {Object} Date filter configuration
     */
    buildDateFilters(date, status) {
        const momentInstance = this.options.moment

        if (date.toLowerCase() === 'today') {
            const endOfToday = momentInstance().endOf('day').valueOf()

            if (status === 'open') {
                // For open tasks: show tasks due today and earlier (overdue)
                return {
                    field: 'dueDate',
                    operator: '<=',
                    value: endOfToday,
                }
            } else if (status === 'done') {
                // For done tasks: show tasks completed today
                const startOfToday = momentInstance().startOf('day').valueOf()
                return {
                    field: 'completed',
                    operator: 'range',
                    value: { start: startOfToday, end: endOfToday },
                }
            }
        } else {
            // Specific date (YYYY-MM-DD)
            const targetDate = momentInstance(date)
            if (!targetDate.isValid()) {
                throw new Error('Invalid date format. Use YYYY-MM-DD format.')
            }

            const startOfDay = targetDate.startOf('day').valueOf()
            const endOfDay = targetDate.endOf('day').valueOf()

            if (status === 'open') {
                // For specific date with open tasks: show tasks due on that specific day
                return {
                    field: 'dueDate',
                    operator: 'range',
                    value: { start: startOfDay, end: endOfDay },
                }
            } else if (status === 'done') {
                // For done tasks: show tasks completed on that specific day
                return {
                    field: 'completed',
                    operator: 'range',
                    value: { start: startOfDay, end: endOfDay },
                }
            }
        }

        return { field: null, operator: null, value: null }
    }

    /**
     * Execute query and return formatted results
     * @param {Object} params - Query parameters
     * @returns {Object} Query results with metadata
     */
    async getTasks(params) {
        await this.ensureInitialized()

        const {
            projectId,
            userId,
            status = 'open',
            date = null,
            includeSubtasks = false,
            parentId = null,
            limit = 20,
            userPermissions = [FEED_PUBLIC_FOR_ALL],
        } = params

        try {
            // Build and execute query
            const query = this.buildTaskQuery(params)
            const snapshot = await query.get()

            const tasks = []
            snapshot.forEach(doc => {
                const taskData = doc.data()
                tasks.push({
                    id: doc.id,
                    ...taskData,
                    // Format dates for better readability
                    dueDateFormatted: taskData.dueDate
                        ? this.options.moment(taskData.dueDate).format('YYYY-MM-DD HH:mm:ss')
                        : null,
                    completedFormatted: taskData.completed
                        ? this.options.moment(taskData.completed).format('YYYY-MM-DD HH:mm:ss')
                        : null,
                })
            })

            // Build subtasks map if requested
            let subtasksByParent = {}
            if (includeSubtasks && !parentId) {
                // Get subtasks for all returned tasks
                const parentIds = tasks.map(task => task.id)
                if (parentIds.length > 0) {
                    subtasksByParent = await this.getSubtasksForParents(projectId, parentIds, userPermissions)
                }
            }

            // Determine the effective date filter for the response
            let effectiveDateFilter = date || (status === 'open' ? 'today' : null)
            let dateFilterDescription = ''

            if (effectiveDateFilter === 'today') {
                dateFilterDescription =
                    status === 'open' ? 'Today and overdue tasks (dueDate <= end of today)' : 'Tasks completed today'
            } else if (effectiveDateFilter) {
                dateFilterDescription =
                    status === 'open'
                        ? `Tasks due on ${effectiveDateFilter}`
                        : `Tasks completed on ${effectiveDateFilter}`
            }

            return {
                success: true,
                tasks,
                subtasksByParent,
                count: tasks.length,
                projectId,
                status,
                dateFilter: effectiveDateFilter,
                dateFilterDescription,
                includeSubtasks,
                parentId,
                query: {
                    limit,
                    actualCount: tasks.length,
                    hasMore: tasks.length === limit, // Approximation
                },
            }
        } catch (error) {
            console.error('Error retrieving tasks:', error)
            throw new Error(`Failed to retrieve tasks: ${error.message}`)
        }
    }

    /**
     * Get subtasks for multiple parent task IDs
     * @param {string} projectId - Project ID
     * @param {Array} parentIds - Array of parent task IDs
     * @param {Array} userPermissions - User permission array
     * @returns {Object} Map of parentId -> subtasks array
     */
    async getSubtasksForParents(projectId, parentIds, userPermissions = [FEED_PUBLIC_FOR_ALL]) {
        if (!parentIds || parentIds.length === 0) {
            return {}
        }

        try {
            const subtasksByParent = {}

            // Query subtasks for all parents (batch query is more efficient than individual queries)
            const subtasksQuery = this.options.database
                .collection(`items/${projectId}/tasks`)
                .where('parentId', 'in', parentIds.slice(0, 10)) // Firestore 'in' limit is 10
                .where('isSubtask', '==', true)
                .where('isPublicFor', 'array-contains-any', userPermissions)
                .orderBy('sortIndex', 'desc')

            const subtasksSnapshot = await subtasksQuery.get()

            subtasksSnapshot.forEach(doc => {
                const subtask = {
                    id: doc.id,
                    ...doc.data(),
                }

                const parentId = subtask.parentId
                if (!subtasksByParent[parentId]) {
                    subtasksByParent[parentId] = []
                }
                subtasksByParent[parentId].push(subtask)
            })

            return subtasksByParent
        } catch (error) {
            console.error('Error retrieving subtasks:', error)
            return {}
        }
    }

    /**
     * Validate task retrieval parameters
     * @param {Object} params - Parameters to validate
     * @throws {Error} If validation fails
     */
    validateParams(params) {
        const { projectId, status, date, limit } = params

        if (!projectId || typeof projectId !== 'string') {
            throw new Error('Project ID must be a non-empty string')
        }

        if (status && !['open', 'done', 'all'].includes(status)) {
            throw new Error('Status must be one of: open, done, all')
        }

        if (date && typeof date !== 'string') {
            throw new Error('Date must be a string in YYYY-MM-DD format or "today"')
        }

        if (limit && (typeof limit !== 'number' || limit < 1 || limit > 200)) {
            throw new Error('Limit must be a number between 1 and 200')
        }
    }

    /**
     * Get tasks with validation and error handling
     * @param {Object} params - Query parameters
     * @returns {Object} Query results
     */
    async getTasksWithValidation(params) {
        this.validateParams(params)
        return await this.getTasks(params)
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
                config: {
                    database: !!this.options.database,
                    moment: !!this.options.moment,
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
    TaskRetrievalService,
    default: TaskRetrievalService,
}
