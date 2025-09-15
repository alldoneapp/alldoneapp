/**
 * FocusTaskService - Universal focus task management service
 *
 * This service provides a unified API for focus task retrieval and management
 * that works across all platforms and contexts:
 * - MCP Server (Cloud Functions)
 * - Assistant Tool calls (Cloud Functions)
 * - Frontend UI components (React Native/Web)
 * - Backend operations (Cloud Functions)
 * - Any other focus task contexts
 */

const moment = require('moment')

class FocusTaskService {
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
            throw new Error('Database interface is required for FocusTaskService')
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
     * Get current focus task for a user
     * @param {string} userId - User ID
     * @returns {Object|null} Current focus task or null if none set
     */
    async getCurrentFocusTask(userId) {
        await this.ensureInitialized()

        if (!userId || typeof userId !== 'string') {
            throw new Error('User ID is required')
        }

        try {
            // Get user document to retrieve focus task info
            const userDoc = await this.options.database.collection('users').doc(userId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }

            const userData = userDoc.data()
            const { inFocusTaskId, inFocusTaskProjectId } = userData

            if (!inFocusTaskId || !inFocusTaskProjectId) {
                return null // No focus task set
            }

            // Fetch the actual task
            const taskDoc = await this.options.database
                .doc(`items/${inFocusTaskProjectId}/tasks/${inFocusTaskId}`)
                .get()

            if (!taskDoc.exists) {
                // Focus task no longer exists, clear it from user document
                await this.options.database.doc(`users/${userId}`).update({
                    inFocusTaskId: '',
                    inFocusTaskProjectId: '',
                })
                return null
            }

            const taskData = taskDoc.data()

            // Check if task is still open and assigned to user
            if (taskData.done || taskData.inDone || taskData.userId !== userId) {
                // Focus task is completed or no longer assigned to user
                await this.options.database.doc(`users/${userId}`).update({
                    inFocusTaskId: '',
                    inFocusTaskProjectId: '',
                })
                return null
            }

            // Get project name for context
            let projectName = inFocusTaskProjectId
            try {
                const projectDoc = await this.options.database.doc(`projects/${inFocusTaskProjectId}`).get()
                if (projectDoc.exists) {
                    projectName = projectDoc.data().name || projectName
                }
            } catch (error) {
                console.warn('Could not fetch project name:', error.message)
            }

            return {
                id: inFocusTaskId,
                projectId: inFocusTaskProjectId,
                projectName,
                ...taskData,
            }
        } catch (error) {
            console.error('Error getting current focus task:', error)
            throw new Error(`Failed to get current focus task: ${error.message}`)
        }
    }

    /**
     * Find and set a new focus task for a user using the existing algorithm
     * @param {string} userId - User ID
     * @param {string} currentProjectId - Current project context (optional)
     * @param {string} previousTaskParentGoalId - Previous task's parent goal for prioritization (optional)
     * @returns {Object|null} New focus task or null if none found
     */
    async findAndSetNewFocusTask(userId, currentProjectId = null, previousTaskParentGoalId = null) {
        await this.ensureInitialized()

        if (!userId || typeof userId !== 'string') {
            throw new Error('User ID is required')
        }

        try {
            // Get user's projects to search across
            const userDoc = await this.options.database.collection('users').doc(userId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }

            const userData = userDoc.data()
            const userProjectIds = userData.projectIds || []

            if (userProjectIds.length === 0) {
                return null // User has no projects
            }

            // If no current project specified, use user's default or first project
            const searchProjectId = currentProjectId || userData.defaultProjectId || userProjectIds[0]

            const currentTime = this.options.moment()
            const fifteenMinutesFromNow = this.options.moment().add(15, 'minutes')
            const endOfToday = this.options.moment().endOf('day').valueOf()

            // Phase 1: Check for upcoming calendar tasks across all user projects
            let earliestUpcomingCalendarTask = null
            let earliestUpcomingCalendarTaskProject = null
            let earliestStartTime = this.options.moment().add(16, 'minutes')

            for (const projectId of userProjectIds) {
                try {
                    const calendarQuery = this.options.database
                        .collection(`items/${projectId}/tasks`)
                        .where('userId', '==', userId)
                        .where('done', '==', false)
                        .where('inDone', '==', false)
                        .where('isSubtask', '==', false)
                        .where('sortIndex', '>=', currentTime.valueOf())
                        .where('sortIndex', '<', fifteenMinutesFromNow.valueOf())
                        .orderBy('sortIndex', 'asc')

                    const snapshot = await calendarQuery.get()

                    for (const doc of snapshot.docs) {
                        const task = { id: doc.id, ...doc.data() }
                        if (task.calendarData && task.calendarData.start) {
                            const taskStartTimeString = task.calendarData.start.dateTime || task.calendarData.start.date
                            const taskStartTime = this.options.moment(taskStartTimeString)
                            if (
                                taskStartTime.isBetween(currentTime, fifteenMinutesFromNow, undefined, '[)') &&
                                taskStartTime.isBefore(earliestStartTime)
                            ) {
                                earliestUpcomingCalendarTask = task
                                earliestUpcomingCalendarTaskProject = projectId
                                earliestStartTime = taskStartTime
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Error checking calendar tasks in project ${projectId}:`, error.message)
                }
            }

            if (earliestUpcomingCalendarTask) {
                await this.setNewFocusTask(userId, earliestUpcomingCalendarTaskProject, earliestUpcomingCalendarTask)
                return {
                    id: earliestUpcomingCalendarTask.id,
                    projectId: earliestUpcomingCalendarTaskProject,
                    ...earliestUpcomingCalendarTask,
                }
            }

            // Phase 2: Search in specified project with prioritization
            let newFocusedTask = null
            const tasksRef = this.options.database.collection(`items/${searchProjectId}/tasks`)
            let query = tasksRef
                .where('userId', '==', userId)
                .where('done', '==', false)
                .where('inDone', '==', false)
                .where('isSubtask', '==', false)
                .orderBy('sortIndex', 'desc')

            const openTasksSnapshot = await query.limit(200).get()

            if (!openTasksSnapshot.empty) {
                const allFetchedTasks = openTasksSnapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(task => task.dueDate <= endOfToday && !task.calendarData)

                // Prioritize tasks in same goal group as previous task
                if (previousTaskParentGoalId !== null && previousTaskParentGoalId !== undefined) {
                    const tasksInSameGroup = allFetchedTasks.filter(
                        task => task.parentGoalId === previousTaskParentGoalId
                    )
                    const nonWorkflowTasksInGroup = tasksInSameGroup.filter(task => task.userIds.length === 1)
                    if (nonWorkflowTasksInGroup.length > 0) {
                        newFocusedTask = nonWorkflowTasksInGroup[0]
                    } else if (tasksInSameGroup.length > 0) {
                        newFocusedTask = tasksInSameGroup[0]
                    }
                }

                // Fallback to any available task
                if (!newFocusedTask) {
                    const nonWorkflowTasks = allFetchedTasks.filter(task => task.userIds.length === 1)
                    if (nonWorkflowTasks.length > 0) {
                        newFocusedTask = nonWorkflowTasks[0]
                    } else if (allFetchedTasks.length > 0) {
                        newFocusedTask = allFetchedTasks[0]
                    }
                }
            }

            if (newFocusedTask) {
                await this.setNewFocusTask(userId, searchProjectId, newFocusedTask)
                return {
                    id: newFocusedTask.id,
                    projectId: searchProjectId,
                    ...newFocusedTask,
                }
            }

            // Phase 3: Search across other user projects
            for (const projectId of userProjectIds) {
                if (projectId === searchProjectId) continue

                try {
                    const otherProjectQuery = this.options.database
                        .collection(`items/${projectId}/tasks`)
                        .where('userId', '==', userId)
                        .where('done', '==', false)
                        .where('inDone', '==', false)
                        .where('isSubtask', '==', false)
                        .orderBy('sortIndex', 'desc')
                        .limit(50)

                    const otherProjectSnapshot = await otherProjectQuery.get()
                    if (!otherProjectSnapshot.empty) {
                        const tasksFromOtherProject = otherProjectSnapshot.docs
                            .map(doc => ({ id: doc.id, ...doc.data() }))
                            .filter(task => task.dueDate <= endOfToday && !task.calendarData)

                        if (tasksFromOtherProject.length > 0) {
                            const taskFromOtherProject = tasksFromOtherProject[0]
                            await this.setNewFocusTask(userId, projectId, taskFromOtherProject)
                            return {
                                id: taskFromOtherProject.id,
                                projectId: projectId,
                                ...taskFromOtherProject,
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Error searching tasks in project ${projectId}:`, error.message)
                }
            }

            return null // No suitable task found
        } catch (error) {
            console.error('Error finding new focus task:', error)
            throw new Error(`Failed to find new focus task: ${error.message}`)
        }
    }

    /**
     * Set a specific task as the user's focus task
     * @param {string} userId - User ID
     * @param {string} projectId - Project ID
     * @param {Object} task - Task object
     */
    async setNewFocusTask(userId, projectId, task) {
        await this.ensureInitialized()

        if (!userId || !projectId || !task || !task.id) {
            throw new Error('User ID, project ID, and task are required')
        }

        try {
            const batch = this.options.database.batch()

            // Update task with focus timing
            const taskRef = this.options.database.doc(`items/${projectId}/tasks/${task.id}`)
            const GAP = 1000000000000000
            const focusSortIndex = Number.MAX_SAFE_INTEGER - GAP + Date.now()

            batch.update(taskRef, {
                sortIndex: focusSortIndex,
                dueDate: this.options.moment().valueOf(), // Set due date to now for focus
            })

            // Update user's focus task info
            const userRef = this.options.database.doc(`users/${userId}`)
            batch.update(userRef, {
                inFocusTaskId: task.id,
                inFocusTaskProjectId: projectId,
            })

            await batch.commit()

            console.log(`Set new focus task: ${task.name} (${task.id}) in project ${projectId} for user ${userId}`)
        } catch (error) {
            console.error('Error setting new focus task:', error)
            throw new Error(`Failed to set new focus task: ${error.message}`)
        }
    }

    /**
     * Get focus task for user - returns current focus task or finds/sets new one
     * @param {string} userId - User ID
     * @param {string} projectId - Current project context (optional)
     * @returns {Object} Focus task result
     */
    async getFocusTask(userId, projectId = null, options = {}) {
        await this.ensureInitialized()

        const selectMinimalFields = !!options.selectMinimalFields

        let currentFocusTask = await this.getCurrentFocusTask(userId)
        let wasNewTaskSet = false

        if (!currentFocusTask) {
            // No current focus task, find and set a new one
            currentFocusTask = await this.findAndSetNewFocusTask(userId, projectId)
            wasNewTaskSet = !!currentFocusTask
        }

        if (!currentFocusTask) {
            return {
                success: true,
                focusTask: null,
                wasNewTaskSet: false,
                message: 'No focus task available - no open tasks found',
            }
        }

        // Get project name for better display
        let projectName = currentFocusTask.projectId
        try {
            const projectDoc = await this.options.database.doc(`projects/${currentFocusTask.projectId}`).get()
            if (projectDoc.exists) {
                projectName = projectDoc.data().name || projectName
            }
        } catch (error) {
            console.warn('Could not fetch project name for focus task:', error.message)
        }

        const fullFocusTask = { ...currentFocusTask, projectName }

        const minimalFocusTask = selectMinimalFields
            ? {
                  documentId: fullFocusTask.id,
                  projectId: fullFocusTask.projectId,
                  projectName: fullFocusTask.projectName,
                  name: fullFocusTask.name,
                  humanReadableId: fullFocusTask.humanReadableId || fullFocusTask.human_readable_id || null,
                  dueDate: fullFocusTask.dueDate || null,
                  sortIndex: fullFocusTask.sortIndex || 0,
                  parentGoal: fullFocusTask.parentId || fullFocusTask.parentGoalId || null,
              }
            : fullFocusTask

        return {
            success: true,
            focusTask: minimalFocusTask,
            wasNewTaskSet,
            message: wasNewTaskSet
                ? `New focus task set: ${fullFocusTask.name}`
                : `Current focus task: ${fullFocusTask.name}`,
        }
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
    FocusTaskService,
    default: FocusTaskService,
}
