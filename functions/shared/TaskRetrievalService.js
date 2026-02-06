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

const moment = require('moment-timezone')

// Constants - these MUST match the constants in Utils/HelperFunctionsCloud.js
const OPEN_STEP = 'Open'
const FEED_PUBLIC_FOR_ALL = 0 // Must be 0 (number) to match HelperFunctionsCloud.js

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

    static normalizeTimezoneOffset(value) {
        if (value === null || value === undefined) {
            return null
        }

        const convertNumber = num => {
            if (Number.isNaN(num)) return null
            if (Math.abs(num) <= 16 && Number.isInteger(num)) {
                return num * 60
            }
            return num
        }

        if (typeof value === 'number') {
            return convertNumber(value)
        }

        if (typeof value === 'string') {
            let trimmed = value.trim()
            if (!trimmed) return null

            if (trimmed.toUpperCase() === 'Z' || trimmed.toUpperCase() === 'UTC') {
                return 0
            }

            const tzPrefixMatch = trimmed.match(/^(UTC|GMT)(.+)$/i)
            if (tzPrefixMatch) {
                trimmed = tzPrefixMatch[2].trim()
            }

            const match = trimmed.match(/^([+-]?)(\d{1,2}):(\d{2})$/)
            if (match) {
                const sign = match[1] === '-' ? -1 : 1
                const hours = parseInt(match[2], 10)
                const minutes = parseInt(match[3], 10)
                if (Number.isNaN(hours) || Number.isNaN(minutes)) {
                    return null
                }
                if (minutes < 0 || minutes >= 60) {
                    return null
                }
                return sign * (hours * 60 + minutes)
            }

            const numeric = Number(trimmed)
            if (!Number.isNaN(numeric)) {
                return convertNumber(numeric)
            }
        }

        return null
    }

    applyTimezone(momentInstance, timezoneOffset) {
        if (typeof timezoneOffset === 'number' && !Number.isNaN(timezoneOffset)) {
            return momentInstance.utcOffset(timezoneOffset)
        }
        return momentInstance
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
            restrictToCurrentReviewer = true,
            timezoneOffset = null,
        } = params

        if (!projectId) {
            throw new Error('Project ID is required')
        }

        let query = this.options.database.collection(`items/${projectId}/tasks`)

        // Visibility and deletion: do not filter here to match structured query across projects

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
            // Align with structured query: only inDone == false
            query = query.where('inDone', '==', false)
        } else if (status === 'done') {
            query = query.where('done', '==', true).where('inDone', '==', true)
        }
        // status === 'all' means no status filtering

        // Filter by current reviewer (align with main app per-user open list) - default true for MCP/assistants
        if (
            (restrictToCurrentReviewer === undefined || restrictToCurrentReviewer === true) &&
            userId &&
            status === 'open'
        ) {
            query = query.where('currentReviewerId', '==', userId)
        }

        // Ensure we respect default overdue behaviour for open tasks when no date supplied
        const effectiveDate = date || (status === 'open' ? 'today' : null)

        // Date filtering
        if (effectiveDate && status !== 'all') {
            const dateFilters = this.buildDateFilters(effectiveDate, status, timezoneOffset)
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
        // Treat 0 as unlimited (cap to 1000 for safety)
        const appliedLimit = (() => {
            if (typeof perProjectLimit === 'number') {
                if (perProjectLimit === 0) return 1000
                if (perProjectLimit > 0) return perProjectLimit
            }
            if (limit && limit > 0) return Math.min(limit, 1000)
            return 10
        })()
        if (!options.skipLimit) {
            query = query.limit(Math.min(appliedLimit, 1000))
        }

        return query
    }

    /**
     * Build date filters based on date parameter and status
     * @param {string} date - Date filter ('today', 'YYYY-MM-DD', or 'YYYY-MM-DD to YYYY-MM-DD')
     * @param {string} status - Task status ('open', 'done', 'all')
     * @returns {Object} Date filter configuration
     */
    buildDateFilters(date, status, timezoneOffset = null) {
        const momentFactory = (...args) => {
            const base = this.options.moment(...args)
            return this.applyTimezone(base, timezoneOffset)
        }

        if (!date || typeof date !== 'string') {
            return { field: null, operator: null, value: null }
        }

        const rawInput = date.trim()
        if (!rawInput) {
            return { field: null, operator: null, value: null }
        }

        const normalized = rawInput.toLowerCase()
        const normalizedSpaced = normalized.replace(/[_-]+/g, ' ')
        const field = status === 'done' ? 'completed' : 'dueDate'

        const makeRange = (startMoment, endMoment) => ({
            field,
            operator: 'range',
            value: {
                start: startMoment.valueOf(),
                end: endMoment.valueOf(),
            },
        })

        const makeDayRange = dayMoment => {
            const start = dayMoment.clone().startOf('day')
            const end = dayMoment.clone().endOf('day')
            return makeRange(start, end)
        }

        if (normalized === 'today') {
            const today = momentFactory()
            const startOfToday = today.clone().startOf('day')
            const endOfToday = today.clone().endOf('day')

            if (status === 'open') {
                // For open tasks: show tasks due today and earlier (overdue)
                return {
                    field: 'dueDate',
                    operator: '<=',
                    value: endOfToday.valueOf(),
                }
            }

            if (status === 'done') {
                return makeRange(startOfToday, endOfToday)
            }
        }

        if (normalized === 'yesterday') {
            return makeDayRange(momentFactory().subtract(1, 'day'))
        }

        if (normalized === 'tomorrow') {
            return makeDayRange(momentFactory().add(1, 'day'))
        }

        if (normalizedSpaced === 'this week' || normalizedSpaced === 'current week') {
            const startOfWeek = momentFactory().startOf('week')
            const endOfWeek = startOfWeek.clone().endOf('week')
            return makeRange(startOfWeek, endOfWeek)
        }

        if (
            normalizedSpaced === 'last week' ||
            normalizedSpaced === 'previous week' ||
            normalizedSpaced === 'past week'
        ) {
            const startOfLastWeek = momentFactory().subtract(1, 'week').startOf('week')
            const endOfLastWeek = startOfLastWeek.clone().endOf('week')
            return makeRange(startOfLastWeek, endOfLastWeek)
        }

        if (normalizedSpaced === 'next week') {
            const startOfNextWeek = momentFactory().add(1, 'week').startOf('week')
            const endOfNextWeek = startOfNextWeek.clone().endOf('week')
            return makeRange(startOfNextWeek, endOfNextWeek)
        }

        if (normalizedSpaced === 'this month' || normalizedSpaced === 'current month') {
            const startOfMonth = momentFactory().startOf('month')
            const endOfMonth = startOfMonth.clone().endOf('month')
            return makeRange(startOfMonth, endOfMonth)
        }

        if (
            normalizedSpaced === 'last month' ||
            normalizedSpaced === 'previous month' ||
            normalizedSpaced === 'past month'
        ) {
            const startOfLastMonth = momentFactory().subtract(1, 'month').startOf('month')
            const endOfLastMonth = startOfLastMonth.clone().endOf('month')
            return makeRange(startOfLastMonth, endOfLastMonth)
        }

        if (normalizedSpaced === 'next month') {
            const startOfNextMonth = momentFactory().add(1, 'month').startOf('month')
            const endOfNextMonth = startOfNextMonth.clone().endOf('month')
            return makeRange(startOfNextMonth, endOfNextMonth)
        }

        const rollingPastMatch = normalizedSpaced.match(/^(last|past)\s+(\d+)\s+days?$/)
        if (rollingPastMatch) {
            const days = parseInt(rollingPastMatch[2], 10)
            if (!Number.isNaN(days) && days > 0) {
                const end = momentFactory().endOf('day')
                const start = end
                    .clone()
                    .subtract(days - 1, 'days')
                    .startOf('day')
                return makeRange(start, end)
            }
        }

        const rollingFutureMatch = normalizedSpaced.match(/^next\s+(\d+)\s+days?$/)
        if (rollingFutureMatch) {
            const days = parseInt(rollingFutureMatch[1], 10)
            if (!Number.isNaN(days) && days > 0) {
                const start = momentFactory().startOf('day')
                const end = start
                    .clone()
                    .add(days - 1, 'days')
                    .endOf('day')
                return makeRange(start, end)
            }
        }

        // Date range (YYYY-MM-DD to YYYY-MM-DD)
        const rangeMatch = rawInput.match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/)
        if (rangeMatch) {
            const start = momentFactory(rangeMatch[1])
            const end = momentFactory(rangeMatch[2])
            if (start.isValid() && end.isValid()) {
                return makeRange(start.startOf('day'), end.endOf('day'))
            }
        }

        // Specific date (YYYY-MM-DD)
        const targetDate = momentFactory(rawInput)
        if (!targetDate.isValid()) {
            throw new Error(
                'Invalid date format. Use YYYY-MM-DD, "YYYY-MM-DD to YYYY-MM-DD", or a supported keyword like "today", "yesterday", or "this week".'
            )
        }

        return makeDayRange(targetDate)
    }

    /**
     * Human readable description for a date filter key
     * @param {string|null} dateKey
     * @param {string} status
     * @returns {string}
     */
    describeDateFilter(dateKey, status) {
        if (!dateKey || typeof dateKey !== 'string') {
            return ''
        }

        const normalized = dateKey.trim().toLowerCase()
        if (!normalized) return ''
        const normalizedSpaced = normalized.replace(/[_-]+/g, ' ')

        const prefix = phrase => (status === 'open' ? `Tasks due ${phrase}` : `Tasks completed ${phrase}`)

        switch (normalized) {
            case 'today':
                return status === 'open' ? 'Today' : 'Tasks completed today'
            case 'yesterday':
                return prefix('yesterday')
            case 'tomorrow':
                return prefix('tomorrow')
            default:
                break
        }

        switch (normalizedSpaced) {
            case 'this week':
            case 'current week':
                return prefix('this week')
            case 'last week':
            case 'previous week':
            case 'past week':
                return prefix('last week')
            case 'next week':
                return prefix('next week')
            case 'this month':
            case 'current month':
                return prefix('this month')
            case 'last month':
            case 'previous month':
            case 'past month':
                return prefix('last month')
            case 'next month':
                return prefix('next month')
            default:
                break
        }

        const rollingPastMatch = normalizedSpaced.match(/^(last|past)\s+(\d+)\s+days?$/)
        if (rollingPastMatch) {
            const quantity = parseInt(rollingPastMatch[2], 10)
            const plural = quantity === 1 ? '' : 's'
            return prefix(`in the ${rollingPastMatch[1]} ${quantity} day${plural}`)
        }

        const rollingFutureMatch = normalizedSpaced.match(/^next\s+(\d+)\s+days?$/)
        if (rollingFutureMatch) {
            const quantity = parseInt(rollingFutureMatch[1], 10)
            const plural = quantity === 1 ? '' : 's'
            return prefix(`in the next ${quantity} day${plural}`)
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            return status === 'open' ? `Tasks due on ${dateKey}` : `Tasks completed on ${dateKey}`
        }

        return status === 'open'
            ? `Tasks due filtered by "${normalizedSpaced}"`
            : `Tasks completed filtered by "${normalizedSpaced}"`
    }

    /**
     * Execute query and return formatted results
     * @param {Object} params - Query parameters
     * @returns {Object} Query results with metadata
     */
    async getTasks(params) {
        await this.ensureInitialized()

        const normalizedTimezoneOffset = TaskRetrievalService.normalizeTimezoneOffset(params.timezoneOffset)

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
            restrictToCurrentReviewer = false,
        } = params

        try {
            // Build and execute query
            const query = this.buildTaskQuery({ ...params, timezoneOffset: normalizedTimezoneOffset })
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
                        const m = this.applyTimezone(this.options.moment(startString), normalizedTimezoneOffset)
                        if (m && m.isValid && m.isValid()) {
                            calendarTime = m.format('HH:mm')
                        }
                    }
                } catch (_) {}

                // Check if task is the user's current focus task
                let isFocus = false
                try {
                    if (userId && task.id) {
                        // This will be set by the parent function after checking user's inFocusTaskId
                        // For now we set it to false and let the parent function update it
                        isFocus = false
                    }
                } catch (_) {}

                return {
                    documentId: task.id,
                    projectId: pId || task.projectId || projectId,
                    projectName: pName || task.projectName || providedProjectName || undefined,
                    name: task.name,
                    done: !!task.done,
                    completed: task.completed || null,
                    humanReadableId: task.humanReadableId || task.human_readable_id || null,
                    dueDate: task.dueDate || null,
                    sortIndex: task.sortIndex || 0,
                    parentGoal: task.parentId || null,
                    calendarTime,
                    isFocus,
                }
            }

            const projectedTasks = selectMinimalFields
                ? tasks.map(t => mapToMinimal(t, projectId, providedProjectName))
                : tasks.map(t => ({
                      ...t,
                      dueDateFormatted: t.dueDate
                          ? this.applyTimezone(this.options.moment(t.dueDate), normalizedTimezoneOffset).format(
                                'YYYY-MM-DD HH:mm:ss'
                            )
                          : null,
                      completedFormatted: t.completed
                          ? this.applyTimezone(this.options.moment(t.completed), normalizedTimezoneOffset).format(
                                'YYYY-MM-DD HH:mm:ss'
                            )
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
            const effectiveDateFilter = date || (status === 'open' ? 'today' : null)
            const dateFilterDescription = this.describeDateFilter(effectiveDateFilter, status)

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
                                    // Mark the task as in focus
                                    if (selectMinimalFields) {
                                        projectedTasks[idx].isFocus = true
                                    }
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
                    restrictToCurrentReviewer,
                    timezoneOffset: normalizedTimezoneOffset,
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
            let summary = ''
            if (focusTask) {
                summary += focusTaskInResults
                    ? `Focus task is in this list at position ${focusTaskIndex + 1}`
                    : `Focus task is not in this list`
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
                    hasMore: totalAvailable > projectedTasks.length,
                },
                focusTask,
                focusTaskInResults,
                focusTaskIndex,
                timezoneOffset: normalizedTimezoneOffset,
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
            throw new Error('Date must be a string in YYYY-MM-DD format or a supported keyword like "today"')
        }

        if (limit && (typeof limit !== 'number' || limit < 1 || limit > 1000)) {
            throw new Error('Limit must be a number between 1 and 1000')
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

        const normalizedTimezoneOffset = TaskRetrievalService.normalizeTimezoneOffset(params.timezoneOffset)

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
                    hasMore: false,
                },
                timezoneOffset: normalizedTimezoneOffset,
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
                        perProjectLimit: Math.min(perProjectLimit, 1000),
                        timezoneOffset: normalizedTimezoneOffset,
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

                    // Always recompute uncapped per-project totals using the same filters
                    let perProjectTotal = 0
                    try {
                        const countBase = {
                            projectId: result.projectId,
                            userId,
                            status,
                            date: effectiveDate,
                            includeSubtasks,
                            parentId,
                            userPermissions,
                            timezoneOffset: normalizedTimezoneOffset,
                        }
                        const countQuery = this.buildTaskQuery(countBase, { skipLimit: true })
                        if (typeof countQuery.count === 'function') {
                            const agg = countQuery.count()
                            const aggSnap = await agg.get()
                            perProjectTotal = aggSnap?.data()?.count ?? 0
                        } else {
                            const PAGE = 200
                            let lastDoc = null
                            while (true) {
                                let pageQuery = countQuery.limit(PAGE)
                                if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc)
                                const pageSnap = await pageQuery.get()
                                if (pageSnap.empty) break
                                perProjectTotal += pageSnap.size
                                lastDoc = pageSnap.docs[pageSnap.docs.length - 1]
                                if (pageSnap.size < PAGE) break
                            }
                        }
                    } catch (_) {
                        perProjectTotal = result.count || 0
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
            const dateFilterDescription = this.describeDateFilter(effectiveDate, status)

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
                                // Mark the task as in focus
                                if (selectMinimalFields) {
                                    allTasks[idx].isFocus = true
                                }
                            } else {
                                focusTask = { documentId: focusId, projectId: focusProjectId, name: undefined }
                            }
                        }
                    }
                }
            } catch (_) {}

            // Build a short summary that mentions the focus task presence
            let summary = ''
            if (focusTask) summary += focusTaskInResults ? 'Focus task is included' : 'Focus task not included'

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
                    hasMore: false,
                },
                focusTask,
                focusTaskInResults,
                timezoneOffset: normalizedTimezoneOffset,
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
