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
    buildTaskQuery(params, options = {}) {
        const {
            projectId,
            userId,
            status = 'open',
            date = null,
            includeSubtasks = false,
            parentId = null,
            limit = 20,
            perProjectLimit = undefined,
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

        // Exclude deleted tasks (align with main app)
        query = query.where('isDeleted', '==', false)

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

        // Apply per-project limit (defaults to 10 if not specified)
        // Treat 0 as unlimited (cap to 200 for safety)
        const appliedLimit = (() => {
            if (typeof perProjectLimit === 'number') {
                if (perProjectLimit === 0) return 200
                if (perProjectLimit > 0) return perProjectLimit
            }
            if (limit && limit > 0) return Math.min(limit, 200)
            return 10
        })()
        if (!options.skipLimit) {
            query = query.limit(Math.min(appliedLimit, 200))
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
            perProjectLimit = 10,
            userPermissions = [FEED_PUBLIC_FOR_ALL],
            // Optional projection controls
            selectMinimalFields = false,
            projectName: providedProjectName = undefined,
        } = params

        try {
            // Build and execute query
            const query = this.buildTaskQuery(params)
            const snapshot = await query.get()

            const tasks = []
            snapshot.forEach(doc => {
                const taskData = doc.data()
                tasks.push({ id: doc.id, ...taskData })
            })

            // Apply minimal projection if requested
            const mapToMinimal = (task, pId, pName) => {
                // Derive calendar time (HH:mm) for calendar tasks when a specific dateTime is present
                let calendarTime = null
                try {
                    const startObj = task && task.calendarData && task.calendarData.start
                    const startString = startObj && (startObj.dateTime || startObj.date)
                    if (startString && startObj.dateTime) {
                        const m = this.options.moment(startString)
                        if (m && m.isValid && m.isValid()) {
                            calendarTime = m.format('HH:mm')
                        }
                    }
                } catch (_) {}

                return {
                    documentId: task.id,
                    projectId: pId || task.projectId || projectId,
                    projectName: pName || task.projectName || providedProjectName || undefined,
                    name: task.name,
                    humanReadableId: task.humanReadableId || task.human_readable_id || null,
                    dueDate: task.dueDate || null,
                    sortIndex: task.sortIndex || 0,
                    parentGoal: task.parentId || null,
                    calendarTime,
                }
            }

            const projectedTasks = selectMinimalFields
                ? tasks.map(t => mapToMinimal(t, projectId, providedProjectName))
                : tasks.map(t => ({
                      ...t,
                      dueDateFormatted: t.dueDate ? this.options.moment(t.dueDate).format('YYYY-MM-DD HH:mm:ss') : null,
                      completedFormatted: t.completed
                          ? this.options.moment(t.completed).format('YYYY-MM-DD HH:mm:ss')
                          : null,
                  }))

            // Build subtasks map if requested
            let subtasksByParent = {}
            if (includeSubtasks && !parentId) {
                // Get subtasks for all returned tasks
                const parentIds = tasks.map(task => task.id)
                if (parentIds.length > 0) {
                    subtasksByParent = await this.getSubtasksForParents(projectId, parentIds, userPermissions)
                    // Apply projection to subtasks as well if requested
                    if (selectMinimalFields && subtasksByParent && typeof subtasksByParent === 'object') {
                        Object.keys(subtasksByParent).forEach(pid => {
                            subtasksByParent[pid] = (subtasksByParent[pid] || []).map(st =>
                                mapToMinimal(st, projectId, providedProjectName)
                            )
                        })
                    }
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

            // Resolve user's current focus task position within results (single-project)
            let focusTaskInResults = false
            let focusTaskIndex = null
            let focusTask = null
            try {
                if (userId) {
                    const userDoc = await this.options.database.collection('users').doc(userId).get()
                    if (userDoc.exists) {
                        const ud = userDoc.data()
                        const focusId = ud.inFocusTaskId
                        const focusProjectId = ud.inFocusTaskProjectId
                        if (focusId && focusProjectId) {
                            if (focusProjectId === projectId) {
                                const idx = projectedTasks.findIndex(
                                    t => (selectMinimalFields ? t.documentId : t.id) === focusId
                                )
                                if (idx > -1) {
                                    focusTaskInResults = true
                                    focusTaskIndex = idx
                                    focusTask = projectedTasks[idx]
                                } else {
                                    focusTask = {
                                        documentId: focusId,
                                        projectId: projectId,
                                        name: undefined,
                                    }
                                }
                            } else {
                                focusTask = {
                                    documentId: focusId,
                                    projectId: focusProjectId,
                                    name: undefined,
                                }
                            }
                        }
                    }
                }
            } catch (_) {}

            // Calculate total count without per-project limits for accurate stats
            let totalAvailable = projectedTasks.length
            try {
                // Rebuild same query without limit to count
                const countBase = {
                    projectId,
                    userId,
                    status,
                    date: effectiveDateFilter,
                    includeSubtasks,
                    parentId,
                    userPermissions,
                }
                const countQuery = this.buildTaskQuery(countBase, { skipLimit: true })
                if (typeof countQuery.count === 'function') {
                    const agg = countQuery.count()
                    const aggSnap = await agg.get()
                    totalAvailable = aggSnap?.data()?.count ?? totalAvailable
                } else {
                    const PAGE = 200
                    let lastDoc = null
                    let counted = 0
                    while (true) {
                        let pageQuery = countQuery.limit(PAGE)
                        if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc)
                        const pageSnap = await pageQuery.get()
                        if (pageSnap.empty) break
                        counted += pageSnap.size
                        lastDoc = pageSnap.docs[pageSnap.docs.length - 1]
                        if (pageSnap.size < PAGE) break
                    }
                    totalAvailable = counted
                }
            } catch (_) {}

            // Build a small summary string using uncapped totals and focus task info
            let summary = `Found ${totalAvailable} task(s)`
            if (dateFilterDescription) summary += ` (${dateFilterDescription})`
            if (focusTask) {
                summary += focusTaskInResults
                    ? `; Focus task is in this list at position ${focusTaskIndex + 1}`
                    : `; Focus task is not in this list`
            }

            return {
                success: true,
                tasks: projectedTasks,
                subtasksByParent,
                count: projectedTasks.length,
                projectId,
                status,
                dateFilter: dateFilterDescription,
                summary,
                includeSubtasks,
                parentId,
                query: {
                    perProjectLimit,
                    actualCount: projectedTasks.length,
                    hasMore: totalAvailable > projectedTasks.length,
                    totalAvailable,
                },
                focusTask,
                focusTaskInResults,
                focusTaskIndex,
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
     * Get tasks from multiple projects
     * @param {Object} params - Query parameters
     * @param {Array} projectIds - Array of project IDs to query
     * @param {Object} projectsData - Map of projectId -> project metadata
     * @returns {Object} Aggregated query results
     */
    async getTasksFromMultipleProjects(params, projectIds, projectsData = {}) {
        await this.ensureInitialized()

        if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
            return {
                success: true,
                tasks: [],
                subtasksByParent: {},
                count: 0,
                totalAcrossProjects: 0,
                projectSummary: {},
                queriedProjects: [],
                query: {
                    limit: params.limit || 20,
                    actualCount: 0,
                    hasMore: false,
                },
            }
        }

        const {
            userId,
            status = 'open',
            date = null,
            includeSubtasks = false,
            parentId = null,
            limit = 20,
            perProjectLimit = 10,
            userPermissions = [FEED_PUBLIC_FOR_ALL],
            // Optional projection controls
            selectMinimalFields = false,
        } = params

        // For cross-project queries, ensure we always have proper date filtering
        // Default to 'today' for open tasks to get today and overdue tasks only
        const effectiveDate = date || (status === 'open' ? 'today' : null)

        try {
            console.log(`🔍 Multi-project task query for ${projectIds.length} projects:`, projectIds.slice(0, 5))

            // Execute queries in parallel for all projects
            const projectQueries = projectIds.map(async projectId => {
                try {
                    const projectParams = {
                        ...params,
                        projectId,
                        date: effectiveDate, // Ensure consistent date filtering across all projects
                        // For cross-project queries, respect date filtering strictly and don't over-fetch
                        // This ensures we only get tasks for the specific day requested
                        perProjectLimit: Math.min(perProjectLimit, 200),
                    }

                    const result = await this.getTasks(projectParams)
                    return {
                        projectId,
                        projectName: projectsData[projectId]?.name || projectId,
                        success: true,
                        ...result,
                    }
                } catch (error) {
                    console.warn(`Failed to get tasks from project ${projectId}:`, error.message)
                    return {
                        projectId,
                        projectName: projectsData[projectId]?.name || projectId,
                        success: false,
                        tasks: [],
                        count: 0,
                        error: error.message,
                    }
                }
            })

            const projectResults = await Promise.all(projectQueries)

            // Aggregate results
            let allTasks = []
            let allSubtasksByParent = {}
            let projectSummary = {}
            let totalAcrossProjects = 0

            for (const result of projectResults) {
                if (result.success && result.tasks) {
                    // Add project context to each task
                    const tasksWithProjectInfo = result.tasks.map(task => ({
                        ...task,
                        projectId: result.projectId,
                        projectName: result.projectName,
                    }))

                    allTasks = allTasks.concat(tasksWithProjectInfo)

                    // Merge subtasks
                    if (result.subtasksByParent) {
                        allSubtasksByParent = { ...allSubtasksByParent, ...result.subtasksByParent }
                    }

                    // Ensure per-project totals are accurate: recompute uncapped count if not provided
                    let perProjectTotal =
                        result.query && typeof result.query.totalAvailable === 'number'
                            ? result.query.totalAvailable
                            : null
                    if (perProjectTotal === null) {
                        try {
                            const countBase = {
                                projectId: result.projectId,
                                userId,
                                status,
                                date: effectiveDate,
                                includeSubtasks,
                                parentId,
                                userPermissions,
                            }
                            const countQuery = this.buildTaskQuery(countBase, { skipLimit: true })
                            if (typeof countQuery.count === 'function') {
                                const agg = countQuery.count()
                                const aggSnap = await agg.get()
                                perProjectTotal = aggSnap?.data()?.count ?? result.count
                            } else {
                                const PAGE = 200
                                let lastDoc = null
                                let counted = 0
                                while (true) {
                                    let pageQuery = countQuery.limit(PAGE)
                                    if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc)
                                    const pageSnap = await pageQuery.get()
                                    if (pageSnap.empty) break
                                    counted += pageSnap.size
                                    lastDoc = pageSnap.docs[pageSnap.docs.length - 1]
                                    if (pageSnap.size < PAGE) break
                                }
                                perProjectTotal = counted
                            }
                        } catch (_) {
                            perProjectTotal = result.count || 0
                        }
                    }

                    projectSummary[result.projectId] = {
                        projectName: result.projectName,
                        taskCount: perProjectTotal,
                        success: true,
                    }

                    totalAcrossProjects += perProjectTotal
                } else {
                    projectSummary[result.projectId] = {
                        projectName: result.projectName,
                        taskCount: 0,
                        success: false,
                        error: result.error,
                    }
                }
            }

            // Sort all tasks globally (matches existing sort patterns)
            if (status === 'done') {
                // For done tasks: order by completion date first, then sortIndex
                allTasks.sort((a, b) => {
                    const aCompleted = a.completed || 0
                    const bCompleted = b.completed || 0
                    if (aCompleted !== bCompleted) {
                        return bCompleted - aCompleted // Desc
                    }
                    const aSortIndex = a.sortIndex || 0
                    const bSortIndex = b.sortIndex || 0
                    return bSortIndex - aSortIndex // Desc
                })
            } else {
                // For open tasks: order by sortIndex (creation/priority order)
                allTasks.sort((a, b) => {
                    const aSortIndex = a.sortIndex || 0
                    const bSortIndex = b.sortIndex || 0
                    return bSortIndex - aSortIndex // Desc
                })
            }

            // Determine the effective date filter for the response
            let dateFilterDescription = ''

            if (effectiveDate === 'today') {
                dateFilterDescription =
                    status === 'open' ? 'Today and overdue tasks (dueDate <= end of today)' : 'Tasks completed today'
            } else if (effectiveDate) {
                dateFilterDescription =
                    status === 'open' ? `Tasks due on ${effectiveDate}` : `Tasks completed on ${effectiveDate}`
            }

            const queriedProjects = projectResults
                .filter(r => r.success)
                .map(r => ({
                    projectId: r.projectId,
                    projectName: r.projectName,
                }))

            // Determine user's focus task and whether it's in the aggregated results
            let focusTask = null
            let focusTaskInResults = false
            try {
                if (userId) {
                    const userDoc = await this.options.database.collection('users').doc(userId).get()
                    if (userDoc.exists) {
                        const ud = userDoc.data()
                        const focusId = ud.inFocusTaskId
                        const focusProjectId = ud.inFocusTaskProjectId
                        if (focusId && focusProjectId) {
                            // Try to find it in allTasks
                            const idx = allTasks.findIndex(t => (selectMinimalFields ? t.documentId : t.id) === focusId)
                            if (idx > -1) {
                                focusTaskInResults = true
                                focusTask = allTasks[idx]
                            } else {
                                focusTask = { documentId: focusId, projectId: focusProjectId, name: undefined }
                            }
                        }
                    }
                }
            } catch (_) {}

            // Build a short summary that mentions the focus task presence
            let summary = `Found ${totalAcrossProjects} task(s) across ${queriedProjects.length} project(s)`
            if (dateFilterDescription) summary += ` (${dateFilterDescription})`
            if (focusTask) summary += focusTaskInResults ? '; Focus task is included' : '; Focus task not included'

            return {
                success: true,
                tasks: allTasks,
                subtasksByParent: allSubtasksByParent,
                count: allTasks.length,
                totalAcrossProjects,
                projectSummary,
                queriedProjects,
                status,
                dateFilter: dateFilterDescription,
                summary,
                includeSubtasks,
                parentId,
                query: {
                    perProjectLimit,
                    actualCount: allTasks.length,
                    hasMore: false,
                    totalAvailable: allTasks.length,
                },
                focusTask,
                focusTaskInResults,
            }
        } catch (error) {
            console.error('Error retrieving tasks from multiple projects:', error)
            throw new Error(`Failed to retrieve tasks from multiple projects: ${error.message}`)
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
