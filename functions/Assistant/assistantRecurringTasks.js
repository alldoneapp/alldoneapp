const admin = require('firebase-admin')
const moment = require('moment')
const { getAssistantTasks } = require('../Firestore/templatesFirestore')
const { generatePreConfigTaskResult } = require('./assistantPreConfigTaskTopic')
const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { getId } = require('../Firestore/generalFirestoreCloud')
const { GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')
// Removed createTaskCreatedFeed import - now using TaskService for unified task creation

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

async function shouldExecuteTask(task, projectId) {
    if (!task.startDate || !task.startTime || task.recurrence === RECURRENCE_NEVER) {
        return false
    }

    // Get the user's timezone offset from their settings as fallback
    const userDoc = await admin.firestore().doc(`users/${task.userId}`).get()
    const userTimezoneOffset = task.userTimezone || userDoc.data()?.timezone || 0

    // Create moment objects with the correct timezone
    const now = moment().utcOffset(userTimezoneOffset)
    const originalScheduledTime = moment(task.startDate).utcOffset(userTimezoneOffset)
    const [hours, minutes] = task.startTime.split(':').map(Number)

    // Set the time in the user's timezone
    originalScheduledTime.hour(hours).minute(minutes).second(0)

    console.log('Initial task timing check:', {
        taskId: task.id,
        taskName: task.name,
        startDate: task.startDate,
        startTime: task.startTime,
        recurrence: task.recurrence,
        currentTime: now.format('YYYY-MM-DD HH:mm:ss Z'),
        originalScheduledTime: originalScheduledTime.format('YYYY-MM-DD HH:mm:ss Z'),
        effectiveTimezone: userTimezoneOffset,
    })

    // If original scheduled time is in the future, don't execute
    if (originalScheduledTime.isAfter(now)) {
        console.log('Original scheduled time is in future, skipping execution')
        return false
    }

    // If task has never been executed, and we're past the start time, execute it
    if (!task.lastExecuted) {
        console.log('Task has never been executed, executing first time')
        return true
    }

    // Get the last execution time - convert from UTC server timestamp to user's timezone
    console.log('KW Special Task last executed - check ob die Datenbank Zeit geändert wurde:', {
        lastExecuted: task.lastExecuted,
        lastExecutedLocal: moment
            .utc(task.lastExecuted.toDate())
            .utcOffset(userTimezoneOffset)
            .format('YYYY-MM-DD HH:mm:ss Z'),
    })
    const lastExecutedLocal = moment.utc(task.lastExecuted.toDate()).utcOffset(userTimezoneOffset)

    console.log('KW Special last executed local:', {
        lastExecutedLocal: lastExecutedLocal.format('YYYY-MM-DD HH:mm:ss Z'),
    })

    // Calculate next execution based on original schedule, not last execution
    const nextExecution = getNextExecutionTime(originalScheduledTime, task.recurrence, lastExecutedLocal)

    // Round times to nearest minute
    const nowRounded = now.clone().second(0).millisecond(0)
    const nextExecutionRounded = nextExecution.clone().second(0).millisecond(0)

    const minutesUntilNextExecution = nextExecutionRounded.diff(nowRounded, 'minutes')
    const shouldExecute = minutesUntilNextExecution <= 0

    console.log('Detailed timing comparison:', {
        taskId: task.id,
        taskName: task.name,
        currentTime: nowRounded.format('YYYY-MM-DD HH:mm:ss Z'),
        originalScheduledTime: originalScheduledTime.format('YYYY-MM-DD HH:mm:ss Z'),
        lastExecutedUTC: moment.utc(task.lastExecuted.toDate()).format('YYYY-MM-DD HH:mm:ss Z'),
        lastExecutedLocal: lastExecutedLocal.format('YYYY-MM-DD HH:mm:ss Z'),
        nextExecutionTime: nextExecutionRounded.format('YYYY-MM-DD HH:mm:ss Z'),
        minutesUntilNextExecution: minutesUntilNextExecution,
        shouldExecute: shouldExecute,
        timezoneOffset: userTimezoneOffset,
        currentTimeUnix: nowRounded.unix(),
        nextExecutionUnix: nextExecutionRounded.unix(),
        lastExecutedUnix: lastExecutedLocal.unix(),
    })

    return shouldExecute
}

function getNextExecutionTime(originalScheduledTime, recurrence, lastExecuted) {
    // Clone the original scheduled time to avoid modifying it
    const next = originalScheduledTime.clone()
    const lastExecutedMoment = moment(lastExecuted) // Ensure lastExecuted is a moment object

    console.log('[getNextExecutionTime] Inputs:', {
        originalScheduledTime: originalScheduledTime.format('YYYY-MM-DD HH:mm:ss Z'),
        recurrence,
        lastExecuted: lastExecutedMoment.format('YYYY-MM-DD HH:mm:ss Z'),
        timezoneOffset: originalScheduledTime.utcOffset(),
    })

    // If the original scheduled time is already after the last execution, it's the next one.
    if (next.isAfter(lastExecutedMoment)) {
        console.log('[getNextExecutionTime] Original schedule is after last execution. Returning original.', {
            nextExecution: next.format('YYYY-MM-DD HH:mm:ss Z'),
        })
        return next
    }

    // Iteratively find the first scheduled time strictly after the last execution time
    let iterations = 0
    const maxIterations = 10000 // Safety break for infinite loops
    while (next.isSameOrBefore(lastExecutedMoment) && iterations < maxIterations) {
        iterations++
        switch (recurrence) {
            case RECURRENCE_DAILY:
                next.add(1, 'days')
                break
            case RECURRENCE_EVERY_WORKDAY:
                do {
                    next.add(1, 'days')
                } while (next.isoWeekday() > 5) // Skip weekends (Saturday=6, Sunday=7)
                break
            case RECURRENCE_WEEKLY:
                next.add(1, 'weeks')
                break
            case RECURRENCE_EVERY_2_WEEKS:
                next.add(2, 'weeks')
                break
            case RECURRENCE_EVERY_3_WEEKS:
                next.add(3, 'weeks')
                break
            case RECURRENCE_MONTHLY:
                next.add(1, 'months')
                break
            case RECURRENCE_EVERY_3_MONTHS:
                next.add(3, 'months')
                break
            case RECURRENCE_EVERY_6_MONTHS:
                next.add(6, 'months')
                break
            case RECURRENCE_ANNUALLY:
                next.add(1, 'years')
                break
            default:
                console.warn('[getNextExecutionTime] Unknown recurrence:', recurrence)
                // If recurrence is unknown or 'never', return original time + 1 day to avoid infinite loop if something went wrong
                return originalScheduledTime.clone().add(1, 'day')
        }
    }

    if (iterations >= maxIterations) {
        console.error('[getNextExecutionTime] Max iterations reached. Potential infinite loop detected.', {
            originalScheduledTime: originalScheduledTime.format(),
            lastExecuted: lastExecutedMoment.format(),
            recurrence,
        })
        // Return a time far in the future to prevent accidental execution
        return moment().add(100, 'years')
    }

    console.log('[getNextExecutionTime] Calculated next execution:', {
        nextExecution: next.format('YYYY-MM-DD HH:mm:ss Z'),
        iterations,
    })

    return next
}

/**
 * Creates a new chat object for the task if one doesn't already exist
 * This is necessary for the recurring task to properly store its results
 * @param {string} projectId - The project ID
 * @param {string} taskId - The task ID
 * @param {string} assistantId - The assistant ID
 * @param {string} prompt - The task prompt
 * @returns {Promise<boolean>} - Whether a new chat was created
 */
async function ensureTaskChatExists(projectId, taskId, assistantId, prompt) {
    try {
        console.log('KW Special Always creating new chat for task:', { taskId, assistantId })

        // Get the task data to set proper metadata
        const taskDoc = await admin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${taskId}`).get()
        const task = taskDoc.data()

        if (!task) {
            console.error('Task not found when creating chat:', { taskId, projectId })
            return { uniqueId: null }
        }

        // Determine the follower(s) for the task - prioritize activator, then creator, then first user
        const followerIds = []
        if (task.creatorUserId) {
            followerIds.push(task.creatorUserId)
            console.log('Adding creator user ID as follower IDs:', { creatorUserId: task.creatorUserId })
        }

        // If still no followers, use a fallback 'system' follower
        if (followerIds.length === 0) {
            followerIds.push('system')
        }

        console.log('KW SPECIAL Setting up chat with followers:', {
            followerCount: followerIds.length,
            followerIds,
        })

        // If this is a global project task, use the activated project ID
        if (projectId === GLOBAL_PROJECT_ID && task.activatedInProjectId) {
            projectId = task.activatedInProjectId
            console.log('Using activated project ID:', {
                originalProjectId: GLOBAL_PROJECT_ID,
                newProjectId: projectId,
                activatedInProjectId: task.activatedInProjectId,
            })
        }

        // Create chat object
        const uniqueId = getId()
        const chat = {
            id: uniqueId,
            title: task.extendedName || task.name,
            type: 'tasks',
            members: [task.creatorUserId || task.userId, assistantId], // Include creator first, then assistant
            lastEditionDate: Date.now(),
            lastEditorId: assistantId,
            commentsData: null,
            hasStar: '#FFFFFF',
            creatorId: task.creatorUserId || task.userId,
            isPublicFor: task.isPublicFor || [FEED_PUBLIC_FOR_ALL],
            created: Date.now(),
            usersFollowing: [task.creatorUserId || task.userId], // Only include the creator/user
            quickDateId: '',
            assistantId: assistantId,
            stickyData: { days: 0, stickyEndDate: 0 },
            taskId: taskId, // Add reference to the task
        }

        console.log('KW SPECIAL Creating chat object with data:', {
            chatObject: chat,
            taskId,
            projectId,
            assistantId,
            creatorId: chat.creatorId,
            members: chat.members,
            usersFollowing: chat.usersFollowing,
        })

        // Store the chat object using uniqueId as document ID
        try {
            await admin.firestore().doc(`chatObjects/${projectId}/chats/${uniqueId}`).set(chat)
            console.log('KW SPECIAL Successfully stored chat object in Firestore:', {
                uniqueId,
                projectId,
                chatId: chat.id,
                path: `chatObjects/${projectId}/chats/${uniqueId}`,
            })
        } catch (error) {
            console.error('KW SPECIAL Failed to store chat object in Firestore:', {
                error,
                uniqueId,
                projectId,
                chatId: chat.id,
                path: `chatObjects/${projectId}/chats/${uniqueId}`,
                errorMessage: error.message,
                errorCode: error.code,
            })
            throw error // Re-throw to be caught by the outer try-catch
        }

        // Check if a regular task with the same ID already exists, if not create one
        try {
            const existingTaskDoc = await admin.firestore().doc(`items/${projectId}/tasks/${uniqueId}`).get()

            if (!existingTaskDoc.exists) {
                console.log('Creating regular task with same ID as ChatObject:', { uniqueId, projectId })

                // Create regular task using unified TaskService
                const { TaskService } = require('../shared/TaskService')
                const taskService = new TaskService({
                    database: admin.firestore(),
                    idGenerator: () => uniqueId, // Use the specific uniqueId for this context
                    enableFeeds: true,
                    enableValidation: true,
                    isCloudFunction: true,
                })
                await taskService.initialize()

                try {
                    const result = await taskService.createAndPersistTask(
                        {
                            name: task.name,
                            description: prompt || '',
                            userId: assistantId,
                            projectId: projectId,
                            taskId: uniqueId, // Use the specific ID
                            dueDate: Date.now(),
                            isPrivate: false,
                            // Additional assistant-specific fields
                            assigneeType: 'assistant',
                            assistantId: assistantId,
                            observersIds: followerIds.filter(id => id !== 'system'),
                            recurrence: task.recurrence || 'never',
                            startDate: task.startDate || Date.now(),
                            startTime: task.startTime || '00:00',
                            creatorId: task.creatorUserId || task.userId,
                            isPublicFor: task.isPublicFor || [FEED_PUBLIC_FOR_ALL],
                            // Task-level AI settings that override assistant settings
                            genericData: {
                                aiModel: task.aiModel || null,
                                aiTemperature: task.aiTemperature || null,
                                aiSystemMessage: task.aiSystemMessage || null,
                            },
                            feedUser: feedUserData,
                        },
                        {
                            userId: assistantId,
                            projectId: projectId,
                        }
                    )

                    console.log('Successfully created regular task using TaskService:', {
                        uniqueId: result.taskId,
                        projectId,
                        success: result.success,
                    })
                } catch (taskError) {
                    console.error('Error creating task via TaskService:', {
                        error: taskError,
                        uniqueId,
                        projectId,
                        assistantTaskId: taskId,
                        errorMessage: taskError.message,
                    })
                    throw taskError // Re-throw to be handled by outer try-catch
                }
                // --- End Feed Entry ---
            } else {
                console.log('Regular task already exists with ID:', { uniqueId, projectId })
            }
        } catch (error) {
            console.error('Error creating regular task with same ID as ChatObject:', {
                error,
                uniqueId,
                projectId,
                errorMessage: error.message,
                errorCode: error.code,
            })
            // Continue execution even if task creation fails
        }

        // Create follower entries in the chatFollowers collection using uniqueId
        const batch = admin.firestore().batch()
        for (const followerId of followerIds) {
            if (followerId === 'system') continue // Skip system follower

            const followerRef = admin.firestore().doc(`chatFollowers/${projectId}/${uniqueId}/${followerId}`)
            batch.set(followerRef, {
                lastReadDate: Date.now(),
                firstTimeRead: true,
                userId: followerId,
            })
        }
        await batch.commit()

        // Create initial comment with the prompt
        if (prompt) {
            const commentId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)

            const comment = {
                creatorId: task.userId || task.creatorUserId,
                commentText: prompt,
                commentType: STAYWARD_COMMENT,
                lastChangeDate: Date.now(),
                created: Date.now(),
                originalContent: prompt,
            }

            await admin
                .firestore()
                .doc(`chatComments/${projectId}/tasks/${uniqueId}/comments/${commentId}`)
                .set(comment)

            // Update the chat with comment data
            await admin
                .firestore()
                .doc(`chatObjects/${projectId}/chats/${uniqueId}`)
                .update({
                    commentsData: {
                        lastCommentOwnerId: task.creatorUserId || task.userId,
                        lastComment: prompt.substring(0, 100), // Truncate for preview
                        lastCommentType: STAYWARD_COMMENT,
                        amount: 1,
                    },
                })
        }

        console.log('Successfully created chat and initial message for task:', { uniqueId })
        return { uniqueId }
    } catch (error) {
        console.error('Error creating chat for task:', {
            error,
            projectId,
            taskId,
            assistantId,
        })
        return { uniqueId: null }
    }
}

async function executeAssistantTask(projectId, assistantId, task) {
    const userDoc = await admin.firestore().doc(`users/${task.userId}`).get()
    const userTimezoneOffset = task.userTimezone || userDoc.data()?.timezone || 0

    // Get the creator's user data to check gold balance
    const creatorUserId = task.creatorUserId
    if (!creatorUserId) {
        console.error('No creator user ID found for task:', {
            taskId: task.id,
            taskName: task.name,
        })
        return // Skip execution if no creator ID is found
    }

    // Identify the user who activated this recurring task
    // (the person who should be notified when the task runs)
    const activatorUserId = task.activatorUserId || task.creatorUserId
    if (activatorUserId) {
        console.log('Found activator user ID for task:', {
            taskId: task.id,
            activatorUserId,
        })
    }

    // Use the activatedInProjectId if available, otherwise use the provided projectId
    // This ensures we target the project where the task was activated by the user
    const executionProjectId = task.activatedInProjectId || projectId

    if (executionProjectId !== projectId) {
        console.log('Using different project ID for execution:', {
            taskId: task.id,
            assistantProjectId: projectId,
            executionProjectId: executionProjectId,
        })
    }

    const creatorDoc = await admin.firestore().doc(`users/${creatorUserId}`).get()
    const creatorData = creatorDoc.data()

    if (!creatorData || creatorData.gold <= 0) {
        console.log('Skipping task execution - creator has insufficient gold:', {
            taskId: task.id,
            taskName: task.name,
            creatorUserId,
            creatorGold: creatorData?.gold,
        })
        return // Skip execution if creator has no gold
    }

    console.log('Executing assistant task:', {
        assistantProjectId: projectId,
        executionProjectId: executionProjectId,
        assistantId,
        taskId: task.id,
        taskName: task.name,
        startDate: task.startDate,
        startTime: task.startTime,
        recurrence: task.recurrence,
        taskTimezone: task.userTimezone,
        userTimezone: userDoc.data()?.timezone,
        effectiveTimezone: userTimezoneOffset,
        executionTimeUTC: moment().utc().format(),
        executionTimeLocal: moment().utcOffset(userTimezoneOffset).format(),
        nextScheduledTime: moment(task.startDate).utcOffset(userTimezoneOffset).format('YYYY-MM-DD HH:mm:ss Z'),
        creatorUserId,
        creatorGold: creatorData.gold,
    })

    try {
        // Ensure a chat object exists for this task before trying to generate content
        const { uniqueId } = await ensureTaskChatExists(projectId, task.id, assistantId, task.prompt)

        // Get the proper isPublicFor setting
        const isPublicFor = task.isPublicFor || [FEED_PUBLIC_FOR_ALL]

        // Get follower IDs for proper notifications
        const followerIds = await getTaskFollowerIds(executionProjectId, task.id, task)

        // Log parameters for debugging
        console.log('Calling generatePreConfigTaskResult with parameters:', {
            creatorUserId,
            executionProjectId,
            chatId: uniqueId,
            followerIdsCount: followerIds.length,
            isPublicFor,
            assistantId,
            promptLength: task.prompt?.length,
            aiModel: task.aiModel,
            aiTemperature: task.aiTemperature,
        })

        // Execute the task using the creator's user ID for gold deduction
        await generatePreConfigTaskResult(
            creatorUserId, // Use creator's ID instead of 'system'
            executionProjectId,
            uniqueId,
            followerIds,
            isPublicFor,
            assistantId,
            task.prompt,
            'en', // Default to English
            {
                model: task.aiModel,
                temperature: task.aiTemperature,
                instructions: task.aiSystemMessage,
            }
        )

        // Update the lastExecuted timestamp - store in UTC
        const utcNow = admin.firestore.FieldValue.serverTimestamp()
        await admin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${task.id}`).update({
            lastExecuted: utcNow,
        })

        console.log('Successfully executed assistant task:', {
            assistantProjectId: projectId,
            executionProjectId: executionProjectId,
            assistantId,
            taskId: task.id,
            executionTimeUTC: moment.utc().format('YYYY-MM-DD HH:mm:ss Z'),
            executionTimeLocal: moment().utcOffset(userTimezoneOffset).format('YYYY-MM-DD HH:mm:ss Z'),
            nextExecutionTime: getNextExecutionTime(moment(), task.recurrence, moment.utc())
                .utcOffset(userTimezoneOffset)
                .format('YYYY-MM-DD HH:mm:ss Z'),
            creatorUserId,
            activatorUserId: task.activatorUserId,
            followerIdsCount: followerIds.length,
            followerIds: followerIds,
            remainingGold: creatorData.gold,
        })
    } catch (error) {
        console.error('Error executing assistant task:', {
            error,
            assistantProjectId: projectId,
            executionProjectId: executionProjectId,
            assistantId,
            taskId: task.id,
            taskTimezone: task.userTimezone,
            userTimezone: userDoc.data()?.timezone,
            effectiveTimezone: userTimezoneOffset,
            creatorUserId,
        })
        throw error
    }
}

/**
 * Gets the follower IDs for a task based on the project and task settings
 * @param {string} projectId - The project ID
 * @param {string} taskId - The task ID
 * @param {Object} task - The task data
 * @returns {Promise<string[]>} - Array of user IDs to notify
 */
async function getTaskFollowerIds(projectId, taskId, task) {
    try {
        // Get current followers of the task
        const followersSnapshot = await admin.firestore().collection(`chatFollowers/${projectId}/${taskId}`).get()
        const followerIds = followersSnapshot.docs.map(doc => doc.id)

        console.log('Found follower IDs for task:', {
            taskId,
            followerCount: followerIds.length,
            followerIds,
        })

        // Always include activator user ID (the user who scheduled the recurring task)
        // This is the most important person to notify
        if (task.activatorUserId && !followerIds.includes(task.activatorUserId)) {
            console.log('Adding activator user ID to follower IDs:', { activatorUserId: task.activatorUserId })
            followerIds.push(task.activatorUserId)
        }

        // Always include task creator
        if (task.creatorUserId && !followerIds.includes(task.creatorUserId)) {
            console.log('Adding creator user ID to follower IDs:', { creatorUserId: task.creatorUserId })
            followerIds.push(task.creatorUserId)
        }

        // Include all assigned users
        if (task.userIds && Array.isArray(task.userIds)) {
            task.userIds.forEach(userId => {
                if (!followerIds.includes(userId)) {
                    console.log('Adding assigned user ID to follower IDs:', { userId })
                    followerIds.push(userId)
                }
            })
        }

        // Make sure we always have at least one ID in the array
        // to prevent the error with FieldValue.arrayUnion() requiring at least one argument
        if (followerIds.length === 0) {
            console.log('No follower IDs found for task, adding system user as fallback', { taskId })
            // Adding a 'system' user ID as fallback
            followerIds.push('system')
        }

        console.log('Final follower IDs for task:', {
            taskId,
            followerCount: followerIds.length,
            followerIds,
        })

        return followerIds
    } catch (error) {
        console.error('Error getting follower IDs:', {
            error,
            projectId,
            taskId,
        })
        // Return array with system user to avoid empty array issues
        return ['system']
    }
}

async function checkAndExecuteRecurringTasks() {
    console.log('Starting recurring tasks check')

    try {
        // Get all projects
        const projectsSnapshot = await admin.firestore().collection('projects').get()

        for (const projectDoc of projectsSnapshot.docs) {
            const projectId = projectDoc.id

            // Get all assistants in the project
            const assistantsSnapshot = await admin.firestore().collection(`assistants/${projectId}/items`).get()

            for (const assistantDoc of assistantsSnapshot.docs) {
                const assistantId = assistantDoc.id

                // Get all tasks for this assistant
                const tasks = await getAssistantTasks(admin, projectId, assistantId)

                // Check each task
                for (const task of tasks) {
                    try {
                        if (await shouldExecuteTask(task, projectId)) {
                            await executeAssistantTask(projectId, assistantId, task)
                        }
                    } catch (error) {
                        console.error('Error processing task:', {
                            error,
                            projectId,
                            assistantId,
                            taskId: task.id,
                        })
                        // Continue with other tasks even if one fails
                        continue
                    }
                }
            }
        }

        console.log('Completed recurring tasks check')
    } catch (error) {
        console.error('Error in checkAndExecuteRecurringTasks:', error)
        throw error
    }
}

module.exports = {
    checkAndExecuteRecurringTasks,
    shouldExecuteTask, // Exported for testing
    getNextExecutionTime, // Exported for testing
}
