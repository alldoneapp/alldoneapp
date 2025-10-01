const admin = require('firebase-admin')
const moment = require('moment')
const { cloneDeep } = require('lodash')

// Task recurrence constants
const RECURRENCE_NEVER = 'never'
const RECURRENCE_DAILY = 'daily'
const RECURRENCE_EVERY_WORKDAY = 'everyWorkday'
const RECURRENCE_WEEKLY = 'weekly'
const RECURRENCE_EVERY_2_WEEKS = 'every2Weeks'
const RECURRENCE_EVERY_3_WEEKS = 'every3Weeks'
const RECURRENCE_MONTHLY = 'monthly'
const RECURRENCE_EVERY_3_MONTHS = 'every3Months'
const RECURRENCE_EVERY_6_MONTHS = 'every6Months'
const RECURRENCE_ANNUALLY = 'annually'

const OPEN_STEP = 'open'

/**
 * Creates a recurring task in the cloud function when a task is marked as done
 * This ensures reliable creation regardless of client state
 */
async function createRecurringTaskInCloudFunction(projectId, originalTaskId, completedTask) {
    console.log('🚀 STARTING RECURRING TASK CREATION IN CLOUD FUNCTION:', {
        projectId,
        originalTaskId,
        recurrence: completedTask.recurrence,
        taskName: completedTask.name,
        userIds: completedTask.userIds,
        userId: completedTask.userId,
        creatorId: completedTask.creatorId,
        done: completedTask.done,
        inDone: completedTask.inDone,
    })

    try {
        // Validate recurrence setting
        if (completedTask.recurrence === RECURRENCE_NEVER) {
            console.log('❌ SKIPPING: Task has no recurrence (recurrence = never)')
            return
        }

        // Only create recurring tasks for single-assignee tasks
        if (completedTask.userIds && completedTask.userIds.length > 1) {
            console.log('❌ SKIPPING: Task has multiple assignees:', {
                userIds: completedTask.userIds,
                count: completedTask.userIds.length,
            })
            return
        }

        // Calculate next occurrence date
        console.log('📅 CALCULATING NEXT RECURRENCE DATE...')
        const nextDate = calculateNextRecurrenceDate(completedTask)

        if (!nextDate) {
            console.error('❌ ERROR: Failed to calculate next recurrence date')
            return
        }
        console.log('✅ CALCULATED NEXT DATE:', nextDate.format('YYYY-MM-DD HH:mm:ss'))

        // Create new task based on the completed one
        console.log('🔄 CREATING NEW RECURRING TASK...')
        const newTask = await createNewRecurringTask(projectId, completedTask, nextDate)

        if (!newTask) {
            console.error('❌ ERROR: Failed to create new recurring task')
            return
        }
        console.log('✅ CREATED NEW TASK:', { newTaskId: newTask.id, taskName: newTask.name })

        // Update the original task to remove recurrence
        console.log('🔧 UPDATING ORIGINAL TASK TO REMOVE RECURRENCE...')
        await updateOriginalTaskRecurrence(projectId, originalTaskId, completedTask)
        console.log('✅ UPDATED ORIGINAL TASK')

        console.log('🎉 SUCCESSFULLY CREATED RECURRING TASK:', {
            originalTaskId,
            newTaskId: newTask.id,
            nextDate: nextDate.format('YYYY-MM-DD HH:mm:ss'),
            projectId,
            taskName: newTask.name,
        })

        return newTask
    } catch (error) {
        console.error('💥 CRITICAL ERROR: Failed to create recurring task in cloud function:', {
            errorMessage: error.message,
            errorStack: error.stack,
            errorCode: error.code,
            errorName: error.name,
            projectId,
            originalTaskId,
            taskName: completedTask.name,
            recurrence: completedTask.recurrence,
            completedTaskData: {
                id: completedTask.id,
                done: completedTask.done,
                userIds: completedTask.userIds,
                userId: completedTask.userId,
                creatorId: completedTask.creatorId,
                startDate: completedTask.startDate,
                startTime: completedTask.startTime,
            },
        })

        // Don't re-throw to prevent breaking the onUpdateTask function
        // Log the error and continue with other processing
        return null
    }
}

/**
 * Calculates the next occurrence date based on recurrence pattern
 */
function calculateNextRecurrenceDate(task) {
    const startMoment = moment(task.startDate || task.created)
    const startTime = task.startTime || startMoment.format('HH:mm')
    const [hours, minutes] = startTime.split(':').map(Number)

    // Use the current moment as the base
    let baseDate = moment()
    // Set the time to match the original task's scheduled time
    baseDate = baseDate.hour(hours).minute(minutes).second(0).millisecond(0)

    const recurrenceMap = {
        [RECURRENCE_DAILY]: baseDate.clone().add(1, 'days'),
        [RECURRENCE_EVERY_WORKDAY]: (() => {
            let date = baseDate.clone()
            const today = date.isoWeekday()
            console.log('🗓️ CALCULATING EVERY_WORKDAY:', {
                today: today,
                dayName: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][today],
                currentDate: date.format('YYYY-MM-DD HH:mm:ss'),
            })

            if (today === 5) {
                // Friday: next workday is Monday (add 3 days)
                date.add(3, 'days')
                console.log('✅ Friday detected - adding 3 days to get to Monday')
            } else if (today === 6) {
                // Saturday: next workday is Monday (add 2 days)
                date.add(2, 'days')
                console.log('✅ Saturday detected - adding 2 days to get to Monday')
            } else if (today === 7) {
                // Sunday: next workday is Monday (add 1 day)
                date.add(1, 'days')
                console.log('✅ Sunday detected - adding 1 day to get to Monday')
            } else {
                // Monday-Thursday: next workday is tomorrow (add 1 day)
                date.add(1, 'days')
                console.log('✅ Weekday detected - adding 1 day to get to next day')
            }

            console.log('🗓️ NEXT WORKDAY CALCULATED:', {
                nextDate: date.format('YYYY-MM-DD HH:mm:ss'),
                nextDayName: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][
                    date.isoWeekday()
                ],
            })

            return date
        })(),
        [RECURRENCE_WEEKLY]: baseDate.clone().add(1, 'weeks'),
        [RECURRENCE_EVERY_2_WEEKS]: baseDate.clone().add(2, 'weeks'),
        [RECURRENCE_EVERY_3_WEEKS]: baseDate.clone().add(3, 'weeks'),
        [RECURRENCE_MONTHLY]: baseDate.clone().add(1, 'months'),
        [RECURRENCE_EVERY_3_MONTHS]: baseDate.clone().add(3, 'months'),
        [RECURRENCE_EVERY_6_MONTHS]: baseDate.clone().add(6, 'months'),
        [RECURRENCE_ANNUALLY]: baseDate.clone().add(1, 'years'),
    }

    const nextDate = recurrenceMap[task.recurrence]

    if (!nextDate) {
        console.error('Unknown recurrence pattern:', task.recurrence)
        return null
    }

    console.log('Calculated next recurrence date:', {
        recurrence: task.recurrence,
        originalStartDate: startMoment.format('YYYY-MM-DD HH:mm:ss'),
        startTime: startTime,
        nextDate: nextDate.format('YYYY-MM-DD HH:mm:ss'),
        baseDate: baseDate.format('YYYY-MM-DD HH:mm:ss'),
    })

    return nextDate
}

/**
 * Creates a new task based on the completed recurring task
 */
async function createNewRecurringTask(projectId, originalTask, nextDate) {
    console.log('🔨 ENTERING createNewRecurringTask:', {
        projectId,
        originalTaskName: originalTask.name,
        nextDate: nextDate.format('YYYY-MM-DD HH:mm:ss'),
        originalTaskId: originalTask.id,
    })

    // Use TaskService for consistent task creation
    console.log('📦 LOADING TaskService...')
    const { TaskService } = require('../shared/TaskService')

    console.log('🔧 INITIALIZING TaskService...')
    const taskService = new TaskService({
        database: admin.firestore(),
        enableFeeds: true,
        enableValidation: true,
        isCloudFunction: true,
    })

    await taskService.initialize()
    console.log('✅ TaskService initialized')

    // Clone the original task and prepare it for the new occurrence
    console.log('📋 CLONING ORIGINAL TASK DATA...')
    const newTaskData = cloneDeep(originalTask)
    console.log('✅ Task data cloned')

    // Remove fields that shouldn't be copied
    delete newTaskData.id
    console.log('🗑️ Removed ID from task data')

    // Reset task state for new occurrence
    console.log('🔄 RESETTING TASK STATE FOR NEW OCCURRENCE...')
    newTaskData.done = false
    newTaskData.inDone = false
    newTaskData.created = moment().valueOf()
    newTaskData.startDate = nextDate.valueOf()
    newTaskData.dueDate = nextDate.valueOf()
    newTaskData.completed = null
    newTaskData.completedTime = null
    newTaskData.comments = []
    newTaskData.timesPostponed = 0
    newTaskData.lockKey = ''

    // Update task completion counters
    const endOfToday = moment().endOf('day').valueOf()
    const endExpectedDay = moment(originalTask.dueDate).endOf('day').valueOf()
    if (endOfToday <= endExpectedDay) {
        newTaskData.timesDoneInExpectedDay = (originalTask.timesDoneInExpectedDay || 0) + 1
    } else {
        newTaskData.timesDoneInExpectedDay = 0
    }
    newTaskData.timesDone = (originalTask.timesDone || 0) + 1

    // Reset parent/subtask relationships for recurring tasks
    newTaskData.parentId = null
    newTaskData.isSubtask = false
    newTaskData.subtaskIds = []
    newTaskData.subtaskNames = []

    // Ensure projectId is in the task data
    newTaskData.projectId = projectId

    console.log('✅ Task state reset complete')

    console.log('Creating new recurring task with data:', {
        name: newTaskData.name,
        startDate: moment(newTaskData.startDate).format('YYYY-MM-DD HH:mm:ss'),
        dueDate: moment(newTaskData.dueDate).format('YYYY-MM-DD HH:mm:ss'),
        timesDone: newTaskData.timesDone,
        timesDoneInExpectedDay: newTaskData.timesDoneInExpectedDay,
        recurrence: newTaskData.recurrence,
    })

    // Get creator user data for feed generation
    let feedUser
    try {
        const creatorUserId = originalTask.creatorId || originalTask.userId
        const userDoc = await admin.firestore().collection('users').doc(creatorUserId).get()
        if (userDoc.exists) {
            const userData = userDoc.data()
            feedUser = {
                uid: creatorUserId,
                id: creatorUserId,
                creatorId: creatorUserId,
                name: userData.name || userData.displayName || 'User',
                email: userData.email || '',
            }
        } else {
            feedUser = {
                uid: creatorUserId,
                id: creatorUserId,
                creatorId: creatorUserId,
                name: 'Unknown User',
                email: '',
            }
        }
    } catch (error) {
        console.warn('Could not get user data for recurring task feed, using defaults:', error)
        const creatorUserId = originalTask.creatorId || originalTask.userId
        feedUser = {
            uid: creatorUserId,
            id: creatorUserId,
            creatorId: creatorUserId,
            name: 'Unknown User',
            email: '',
        }
    }

    // Create the task using TaskService
    console.log('🚀 CALLING TaskService.createAndPersistTask with data:', {
        taskName: newTaskData.name,
        projectId: newTaskData.projectId,
        userId: newTaskData.userId,
        creatorId: newTaskData.creatorId,
        startDate: newTaskData.startDate,
        dueDate: newTaskData.dueDate,
        recurrence: newTaskData.recurrence,
        contextUserId: originalTask.creatorId || originalTask.userId,
        contextProjectId: projectId,
    })

    let result
    try {
        result = await taskService.createAndPersistTask(newTaskData, {
            userId: originalTask.creatorId || originalTask.userId,
            projectId: projectId,
            feedUser: feedUser,
        })
    } catch (taskServiceError) {
        console.error('💥 ERROR in TaskService.createAndPersistTask:', {
            error: taskServiceError.message,
            stack: taskServiceError.stack,
            taskName: newTaskData.name,
            projectId,
            userId: originalTask.creatorId || originalTask.userId,
        })
        throw taskServiceError
    }

    console.log('📊 TASKSERVICE RESULT:', {
        success: result.success,
        taskId: result.taskId,
        error: result.error || 'No error',
    })

    if (!result.success) {
        console.error('❌ TaskService failed to create recurring task:', {
            error: result.error,
            taskName: newTaskData.name,
            projectId,
            result: result,
        })
        return null
    }

    // Handle subtasks if the original task had them
    if (originalTask.subtaskIds && originalTask.subtaskIds.length > 0) {
        console.log('Creating subtasks for recurring task:', {
            newTaskId: result.taskId,
            subtaskCount: originalTask.subtaskIds.length,
        })

        try {
            await createSubtasksCopiesInCloudFunction(projectId, result.taskId, originalTask.subtaskIds)
        } catch (error) {
            console.error('Error creating subtasks for recurring task:', {
                error: error.message,
                newTaskId: result.taskId,
                originalSubtasks: originalTask.subtaskIds,
            })
            // Continue even if subtask creation fails
        }
    }

    return { id: result.taskId, ...newTaskData }
}

/**
 * Creates copies of subtasks for a recurring task
 */
async function createSubtasksCopiesInCloudFunction(projectId, newParentTaskId, originalSubtaskIds) {
    console.log('Creating subtask copies for recurring task:', {
        projectId,
        newParentTaskId,
        subtaskCount: originalSubtaskIds.length,
    })

    const batch = admin.firestore().batch()
    const subtaskPromises = []

    for (const subtaskId of originalSubtaskIds) {
        try {
            const subtaskDoc = await admin.firestore().doc(`items/${projectId}/tasks/${subtaskId}`).get()

            if (!subtaskDoc.exists) {
                console.warn('Original subtask not found, skipping:', subtaskId)
                continue
            }

            const originalSubtask = subtaskDoc.data()
            const newSubtaskId = admin.firestore().collection('dummy').doc().id

            const newSubtask = {
                ...originalSubtask,
                id: newSubtaskId,
                parentId: newParentTaskId,
                done: false,
                inDone: false,
                created: moment().valueOf(),
                completed: null,
                completedTime: null,
                timesPostponed: 0,
                lockKey: '',
            }

            delete newSubtask.id // Remove id from data to be stored

            batch.set(admin.firestore().doc(`items/${projectId}/tasks/${newSubtaskId}`), newSubtask)

            subtaskPromises.push(newSubtaskId)
        } catch (error) {
            console.error('Error processing subtask for recurring task:', {
                error: error.message,
                subtaskId,
                newParentTaskId,
            })
        }
    }

    if (subtaskPromises.length > 0) {
        // Update parent task with new subtask IDs
        batch.update(admin.firestore().doc(`items/${projectId}/tasks/${newParentTaskId}`), {
            subtaskIds: subtaskPromises,
        })

        await batch.commit()
        console.log('Successfully created subtasks for recurring task:', {
            newParentTaskId,
            subtaskCount: subtaskPromises.length,
        })
    }
}

/**
 * Updates the original task to remove recurrence after creating the next occurrence
 */
async function updateOriginalTaskRecurrence(projectId, taskId, originalTask) {
    console.log('🔧 STARTING: Updating original task to remove recurrence:', {
        projectId,
        taskId,
        originalRecurrence: originalTask.recurrence,
        taskName: originalTask.name,
    })

    try {
        const docRef = admin.firestore().doc(`items/${projectId}/tasks/${taskId}`)

        console.log('📝 UPDATING FIRESTORE DOCUMENT:', {
            path: `items/${projectId}/tasks/${taskId}`,
            updates: {
                recurrence: RECURRENCE_NEVER,
                timesDoneInExpectedDay: 0,
                timesDone: 0,
            },
        })

        await docRef.update({
            recurrence: RECURRENCE_NEVER,
            timesDoneInExpectedDay: 0,
            timesDone: 0,
        })

        console.log('✅ Successfully updated original task recurrence settings')
    } catch (error) {
        console.error('💥 ERROR updating original task recurrence:', {
            errorMessage: error.message,
            errorCode: error.code,
            errorStack: error.stack,
            projectId,
            taskId,
            taskName: originalTask.name,
            docPath: `items/${projectId}/tasks/${taskId}`,
        })
        throw error
    }
}

module.exports = {
    createRecurringTaskInCloudFunction,
    calculateNextRecurrenceDate,
    createNewRecurringTask,
    updateOriginalTaskRecurrence,
}
