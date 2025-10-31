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
const { generateSortIndex } = require('../Utils/HelperFunctionsCloud')
const { ProjectService } = require('./ProjectService')

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
     * @param {string} excludeTaskId - Task ID to exclude from selection (optional, used for "force new" feature).
     *                                 When provided, selects randomly from top 10 candidates for variety.
     * @returns {Object|null} New focus task or null if none found
     */
    async findAndSetNewFocusTask(
        userId,
        currentProjectId = null,
        previousTaskParentGoalId = null,
        excludeTaskId = null
    ) {
        await this.ensureInitialized()

        if (!userId || typeof userId !== 'string') {
            throw new Error('User ID is required')
        }

        try {
            // Get user's projects to search across
            // Get user's active projects to search across
            const projectService = new ProjectService({ database: this.options.database })
            await projectService.initialize()
            const activeProjects = await projectService.getUserProjects(userId, { activeOnly: true })

            if (activeProjects.length === 0) {
                return null // User has no active projects
            }
            const userProjectIds = activeProjects.map(p => p.id)

            // Fetch user document to get default project
            const userDoc = await this.options.database.collection('users').doc(userId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }
            const userData = userDoc.data()

            // Choose initial project to search:
            // - If a projectId was provided, honor it
            // - Else prefer the user's top-sorted project (by sortIndexByUser desc)
            // - Fallbacks: user's default project, then first user project
            let searchProjectId
            if (currentProjectId) {
                searchProjectId = currentProjectId
            } else {
                try {
                    const projectDocs = await Promise.all(
                        userProjectIds.map(pid => this.options.database.collection('projects').doc(pid).get())
                    )

                    const projectsWithSortIndex = projectDocs
                        .map((doc, index) => {
                            if (doc.exists) {
                                const data = doc.data()
                                const sortIndexByUser = data.sortIndexByUser?.[userId] || 0
                                return { id: userProjectIds[index], sortIndexByUser }
                            }
                            return { id: userProjectIds[index], sortIndexByUser: 0 }
                        })
                        .sort((a, b) => b.sortIndexByUser - a.sortIndexByUser)

                    const topProjectId = projectsWithSortIndex.length > 0 ? projectsWithSortIndex[0].id : null
                    searchProjectId = topProjectId || userData.defaultProjectId || userProjectIds[0]

                    console.log('FocusTaskService: Selected initial project for focus search', {
                        searchProjectId,
                        method: topProjectId
                            ? 'top_sorted'
                            : userData.defaultProjectId
                            ? 'default_project'
                            : 'first_user_project',
                        totalProjects: userProjectIds.length,
                    })
                } catch (projectSortError) {
                    console.warn(
                        'FocusTaskService: Failed to compute top-sorted project, using fallback:',
                        projectSortError.message
                    )
                    searchProjectId = userData.defaultProjectId || userProjectIds[0]
                }
            }

            const currentTime = this.options.moment()
            const fifteenMinutesFromNow = this.options.moment().add(15, 'minutes')
            const endOfToday = this.options.moment().endOf('day').valueOf()

            // Phase 1: Check for upcoming calendar tasks across all user projects
            // Note: Calendar tasks are NOT randomized - we always select the earliest upcoming task
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
                        // Skip excluded task (for "force new" feature)
                        if (excludeTaskId && task.id === excludeTaskId) {
                            continue
                        }
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
            // Note: When excludeTaskId is provided (force new), selects random from top 10 candidates for variety
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
                    .filter(
                        task =>
                            task.dueDate <= endOfToday &&
                            !task.calendarData &&
                            (!excludeTaskId || task.id !== excludeTaskId)
                    )

                // Prioritize tasks in same goal group as previous task
                if (previousTaskParentGoalId !== null && previousTaskParentGoalId !== undefined) {
                    const tasksInSameGroup = allFetchedTasks.filter(
                        task => task.parentGoalId === previousTaskParentGoalId
                    )
                    const nonWorkflowTasksInGroup = tasksInSameGroup.filter(task => task.userIds.length === 1)
                    if (nonWorkflowTasksInGroup.length > 0) {
                        // If excludeTaskId is provided (force new), select random from top 10
                        if (excludeTaskId) {
                            const candidates = nonWorkflowTasksInGroup.slice(0, 10)
                            newFocusedTask = candidates[Math.floor(Math.random() * candidates.length)]
                        } else {
                            newFocusedTask = nonWorkflowTasksInGroup[0]
                        }
                    } else if (tasksInSameGroup.length > 0) {
                        // If excludeTaskId is provided (force new), select random from top 10
                        if (excludeTaskId) {
                            const candidates = tasksInSameGroup.slice(0, 10)
                            newFocusedTask = candidates[Math.floor(Math.random() * candidates.length)]
                        } else {
                            newFocusedTask = tasksInSameGroup[0]
                        }
                    }
                }

                // Fallback to any available task
                if (!newFocusedTask) {
                    const nonWorkflowTasks = allFetchedTasks.filter(task => task.userIds.length === 1)
                    if (nonWorkflowTasks.length > 0) {
                        // If excludeTaskId is provided (force new), select random from top 10
                        if (excludeTaskId) {
                            const candidates = nonWorkflowTasks.slice(0, 10)
                            newFocusedTask = candidates[Math.floor(Math.random() * candidates.length)]
                        } else {
                            newFocusedTask = nonWorkflowTasks[0]
                        }
                    } else if (allFetchedTasks.length > 0) {
                        // If excludeTaskId is provided (force new), select random from top 10
                        if (excludeTaskId) {
                            const candidates = allFetchedTasks.slice(0, 10)
                            newFocusedTask = candidates[Math.floor(Math.random() * candidates.length)]
                        } else {
                            newFocusedTask = allFetchedTasks[0]
                        }
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

            // Phase 3: Search across other user projects (sorted by user preference)
            // Note: When excludeTaskId is provided (force new), selects random from top 10 candidates for variety
            const otherUserProjectIds = userProjectIds.filter(projectId => projectId !== searchProjectId)

            if (otherUserProjectIds.length > 0) {
                // Fetch project metadata to get sortIndexByUser for proper ordering
                let sortedOtherProjectIds = otherUserProjectIds

                try {
                    const projectDocs = await Promise.all(
                        otherUserProjectIds.map(projectId =>
                            this.options.database.collection('projects').doc(projectId).get()
                        )
                    )

                    // Build project data with sortIndexByUser
                    const projectsWithSortIndex = projectDocs
                        .map((doc, index) => {
                            if (doc.exists) {
                                const data = doc.data()
                                const sortIndexByUser = data.sortIndexByUser?.[userId] || 0
                                return {
                                    id: otherUserProjectIds[index],
                                    sortIndexByUser,
                                }
                            }
                            return {
                                id: otherUserProjectIds[index],
                                sortIndexByUser: 0,
                            }
                        })
                        .sort((a, b) => b.sortIndexByUser - a.sortIndexByUser) // Sort descending (higher priority first)

                    sortedOtherProjectIds = projectsWithSortIndex.map(p => p.id)

                    console.log(
                        `FocusTaskService: Sorted ${sortedOtherProjectIds.length} other projects by user preference for ${userId}`
                    )
                } catch (projectSortError) {
                    console.warn(
                        'FocusTaskService: Failed to sort projects by user preference, using original order:',
                        projectSortError.message
                    )
                    // Fall back to original order if sorting fails
                }

                // Search through projects in sorted order (highest priority first)
                for (const projectId of sortedOtherProjectIds) {
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
                                .filter(
                                    task =>
                                        task.dueDate <= endOfToday &&
                                        !task.calendarData &&
                                        (!excludeTaskId || task.id !== excludeTaskId)
                                )

                            if (tasksFromOtherProject.length > 0) {
                                // Prioritize non-workflow tasks first (matching main app logic)
                                const nonWorkflowTasks = tasksFromOtherProject.filter(task => task.userIds.length === 1)

                                let selectedTask
                                if (excludeTaskId) {
                                    // Force new: select random from top 10 candidates
                                    const candidates =
                                        nonWorkflowTasks.length > 0 ? nonWorkflowTasks : tasksFromOtherProject
                                    const topCandidates = candidates.slice(0, 10)
                                    selectedTask = topCandidates[Math.floor(Math.random() * topCandidates.length)]
                                } else {
                                    // Normal: select first task
                                    selectedTask =
                                        nonWorkflowTasks.length > 0 ? nonWorkflowTasks[0] : tasksFromOtherProject[0]
                                }

                                await this.setNewFocusTask(userId, projectId, selectedTask)
                                return {
                                    id: selectedTask.id,
                                    projectId: projectId,
                                    ...selectedTask,
                                }
                            }
                        }
                    } catch (error) {
                        console.warn(`Error searching tasks in project ${projectId}:`, error.message)
                    }
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
    async setNewFocusTask(userId, projectId, task, options = {}) {
        await this.ensureInitialized()

        if (!userId || !projectId || !task || !task.id) {
            throw new Error('User ID, project ID, and task are required')
        }

        try {
            const userRef = this.options.database.doc(`users/${userId}`)
            const userDoc = await userRef.get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }

            const userData = userDoc.data()
            const previousFocusTaskId = userData.inFocusTaskId || ''
            const previousFocusProjectId = userData.inFocusTaskProjectId || ''
            const preserveDueDate = !!options.preserveDueDate

            let previousTaskRestore = null
            if (
                previousFocusTaskId &&
                previousFocusProjectId &&
                (previousFocusTaskId !== task.id || previousFocusProjectId !== projectId)
            ) {
                try {
                    const previousTaskRef = this.options.database.doc(
                        `items/${previousFocusProjectId}/tasks/${previousFocusTaskId}`
                    )
                    const previousTaskSnap = await previousTaskRef.get()
                    if (previousTaskSnap.exists) {
                        const previousTaskData = previousTaskSnap.data()
                        let restoredSortIndex = generateSortIndex()
                        const calendarStart = previousTaskData?.calendarData?.start
                        if (calendarStart) {
                            const startDateTime = calendarStart.dateTime || calendarStart.date
                            if (startDateTime) {
                                restoredSortIndex = this.options.moment(startDateTime).valueOf()
                            }
                        }
                        previousTaskRestore = { ref: previousTaskRef, sortIndex: restoredSortIndex }
                    }
                } catch (restoreError) {
                    console.warn(
                        'FocusTaskService: Failed to prepare previous focus task restore:',
                        restoreError.message
                    )
                }
            }

            const batch = this.options.database.batch()

            // Update task with focus timing
            const taskRef = this.options.database.doc(`items/${projectId}/tasks/${task.id}`)
            const GAP = 1000000000000000
            const focusSortIndex = Number.MAX_SAFE_INTEGER - GAP + Date.now()

            const focusUpdatePayload = {
                sortIndex: focusSortIndex,
            }

            if (!preserveDueDate) {
                focusUpdatePayload.dueDate = this.options.moment().valueOf()
            }

            if (previousTaskRestore) {
                batch.update(previousTaskRestore.ref, { sortIndex: previousTaskRestore.sortIndex })
            }

            batch.update(taskRef, focusUpdatePayload)

            // Update user's focus task info
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

    async clearFocusTask(userId, taskId = null) {
        await this.ensureInitialized()

        if (!userId || typeof userId !== 'string') {
            throw new Error('User ID is required')
        }

        try {
            const userRef = this.options.database.doc(`users/${userId}`)
            const userDoc = await userRef.get()

            if (!userDoc.exists) {
                throw new Error('User not found')
            }

            const userData = userDoc.data()
            const currentFocusTaskId = userData.inFocusTaskId
            const currentFocusProjectId = userData.inFocusTaskProjectId

            if (!currentFocusTaskId || !currentFocusProjectId) {
                return {
                    cleared: false,
                    reason: 'no-focus-task',
                }
            }

            if (taskId && currentFocusTaskId !== taskId) {
                return {
                    cleared: false,
                    reason: 'different-task',
                    currentTaskId: currentFocusTaskId,
                }
            }

            let restoreSortIndex = generateSortIndex()
            let hasTaskSnapshot = false
            try {
                const focusTaskRef = this.options.database.doc(
                    `items/${currentFocusProjectId}/tasks/${currentFocusTaskId}`
                )
                const focusTaskSnap = await focusTaskRef.get()
                if (focusTaskSnap.exists) {
                    hasTaskSnapshot = true
                    const focusTaskData = focusTaskSnap.data()
                    const calendarStart = focusTaskData?.calendarData?.start
                    if (calendarStart) {
                        const startDateTime = calendarStart.dateTime || calendarStart.date
                        if (startDateTime) {
                            restoreSortIndex = this.options.moment(startDateTime).valueOf()
                        }
                    }
                }
            } catch (restoreError) {
                console.warn(
                    'FocusTaskService: Failed to read focus task during clear operation:',
                    restoreError.message
                )
            }

            const batch = this.options.database.batch()

            if (hasTaskSnapshot) {
                const focusTaskRef = this.options.database.doc(
                    `items/${currentFocusProjectId}/tasks/${currentFocusTaskId}`
                )
                batch.update(focusTaskRef, { sortIndex: restoreSortIndex })
            }

            batch.update(userRef, {
                inFocusTaskId: '',
                inFocusTaskProjectId: '',
            })

            await batch.commit()

            console.log(
                `Cleared focus task for user ${userId}. Previous task ${currentFocusTaskId} in project ${currentFocusProjectId}`
            )

            return {
                cleared: true,
                taskId: currentFocusTaskId,
                projectId: currentFocusProjectId,
            }
        } catch (error) {
            console.error('Error clearing focus task:', error)
            throw new Error(`Failed to clear focus task: ${error.message}`)
        }
    }

    /**
     * Get focus task for user - returns current focus task or finds/sets new one
     * @param {string} userId - User ID
     * @param {string} projectId - Current project context (optional)
     * @param {Object} options - Options object
     * @param {boolean} options.selectMinimalFields - Return minimal task fields only
     * @param {boolean} options.forceNew - Force finding a new/different focus task, skipping current one
     * @returns {Object} Focus task result
     */
    async getFocusTask(userId, projectId = null, options = {}) {
        await this.ensureInitialized()

        const selectMinimalFields = !!options.selectMinimalFields
        const forceNew = !!options.forceNew

        let currentFocusTask = await this.getCurrentFocusTask(userId)
        let wasNewTaskSet = false

        // Handle forceNew option - find different task, skipping current one
        if (forceNew) {
            const excludeTaskId = currentFocusTask?.id || null

            // Try to find alternative task
            const newTask = await this.findAndSetNewFocusTask(userId, projectId, null, excludeTaskId)

            // OPTION 1: If no alternative found, return current task with message
            if (!newTask && currentFocusTask) {
                // Get project name for current task
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
                    wasNewTaskSet: false,
                    message: 'No other suitable focus task found. Current focus task remains unchanged.',
                }
            }

            // New task found, update currentFocusTask and proceed
            if (newTask) {
                currentFocusTask = newTask
                wasNewTaskSet = true
            } else {
                // No current task and no alternative found
                return {
                    success: false,
                    focusTask: null,
                    wasNewTaskSet: false,
                    message: 'No suitable focus task found',
                }
            }
        } else if (!currentFocusTask) {
            // Normal flow: No current focus task, find and set a new one
            currentFocusTask = await this.findAndSetNewFocusTask(userId, projectId)
            wasNewTaskSet = !!currentFocusTask
        }

        if (!currentFocusTask) {
            return {
                success: true,
                focusTask: null,
                wasNewTaskSet: false,
                message:
                    'No focus task available for today. Congrats - you have reached empty inbox across all your projects.',
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
