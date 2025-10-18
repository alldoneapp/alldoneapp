const admin = require('firebase-admin')
const moment = require('moment')
const { getAssistantTasks } = require('../Firestore/templatesFirestore')
const { generatePreConfigTaskResult } = require('./assistantPreConfigTaskTopic')
const { FEED_PUBLIC_FOR_ALL, STAYWARD_COMMENT } = require('../Utils/HelperFunctionsCloud')
const { getId } = require('../Firestore/generalFirestoreCloud')
const { GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')
const {
    MINUTES_IN_HOUR,
    resolveTimezoneContext,
    buildOriginalScheduledMoment,
    normalizeTimezoneOffset,
} = require('./timezoneResolver')
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

async function shouldExecuteTask(task, projectId, userDataCache = null) {
    if (!task.startDate || !task.startTime || !task.recurrence || task.recurrence === RECURRENCE_NEVER) {
        return false
    }

    // For assistant tasks, use creatorUserId (the actual user), not userId (which is the assistant ID)
    const userId = task.creatorUserId || task.userId

    // Use cached user data if available to avoid repeated database reads
    let userData
    if (userDataCache && userDataCache.has(userId)) {
        userData = userDataCache.get(userId)
    } else {
        const userDoc = await admin.firestore().doc(`users/${userId}`).get()
        userData = userDoc.exists ? userDoc.data() : {}

        if (!userDoc.exists) {
            console.warn('User not found when evaluating task execution:', {
                taskId: task.id,
                taskName: task.name,
                userId,
                creatorUserId: task.creatorUserId,
                taskUserId: task.userId,
            })
        }
    }

    const timezoneContext = resolveTimezoneContext(task, userData, {}, getNextExecutionTime)
    const evaluation = timezoneContext.selectedEvaluation

    if (!evaluation) {
        console.warn('Unable to resolve timezone context for task, skipping execution check.', {
            taskId: task.id,
            taskName: task.name,
            recurrence: task.recurrence,
            projectId,
        })
        return false
    }

    const effectiveTimezoneHours = evaluation.offsetMinutes / MINUTES_IN_HOUR

    console.log('Initial task timing check:', {
        taskId: task.id,
        taskName: task.name,
        startDate: task.startDate,
        startTime: task.startTime,
        recurrence: task.recurrence,
        currentTime: evaluation.now.format('YYYY-MM-DD HH:mm:ss Z'),
        originalScheduledTime: evaluation.originalScheduledTime.format('YYYY-MM-DD HH:mm:ss Z'),
        effectiveTimezoneMinutes: evaluation.offsetMinutes,
        effectiveTimezoneHours,
        timezoneSources: evaluation.sources,
        userIdForTimezone: userId,
        userTimezone: userData?.timezone,
    })

    const minutesUntilNextExecution = evaluation.minutesUntilNextExecution
    const shouldRunNow =
        typeof minutesUntilNextExecution === 'number' ? minutesUntilNextExecution <= 0 : !!evaluation.shouldExecute

    if (evaluation.isFirstExecution) {
        if (typeof minutesUntilNextExecution === 'number' && minutesUntilNextExecution > 0) {
            console.log('Original scheduled time is in future, skipping execution')
            return false
        }

        console.log('Task has never been executed, executing first time')
        return true
    }

    const lastExecutedUtc = evaluation.lastExecutedLocal.clone().utc()

    console.log('KW Special Task last executed - check ob die Datenbank Zeit geändert wurde:', {
        lastExecuted: task.lastExecuted,
        lastExecutedLocal: evaluation.lastExecutedLocal.format('YYYY-MM-DD HH:mm:ss Z'),
        timezoneOffsetMinutes: evaluation.offsetMinutes,
    })

    console.log('KW Special last executed local:', {
        lastExecutedLocal: evaluation.lastExecutedLocal.format('YYYY-MM-DD HH:mm:ss Z'),
    })

    // Re-run logging for transparency using the selected evaluation context
    getNextExecutionTime(
        evaluation.originalScheduledTime.clone(),
        task.recurrence,
        evaluation.lastExecutedLocal.clone()
    )

    console.log('Detailed timing comparison:', {
        taskId: task.id,
        taskName: task.name,
        currentTime: evaluation.nowRounded.format('YYYY-MM-DD HH:mm:ss Z'),
        originalScheduledTime: evaluation.originalRounded.format('YYYY-MM-DD HH:mm:ss Z'),
        lastExecutedUTC: lastExecutedUtc.format('YYYY-MM-DD HH:mm:ss Z'),
        lastExecutedLocal: evaluation.lastExecutedLocal.format('YYYY-MM-DD HH:mm:ss Z'),
        nextExecutionTime: evaluation.nextExecutionRounded.format('YYYY-MM-DD HH:mm:ss Z'),
        minutesUntilNextExecution: evaluation.minutesUntilNextExecution,
        shouldExecute: evaluation.shouldExecute,
        timezoneOffsetMinutes: evaluation.offsetMinutes,
        timezoneSources: evaluation.sources,
        candidateOffsets: timezoneContext.evaluations.map(candidateEval => ({
            offsetMinutes: candidateEval.offsetMinutes,
            minutesUntilNextExecution: candidateEval.minutesUntilNextExecution,
            shouldExecute: candidateEval.shouldExecute,
            priority: candidateEval.priority,
            sources: candidateEval.sources,
        })),
        currentTimeUnix: evaluation.nowRounded.unix(),
        nextExecutionUnix: evaluation.nextExecutionRounded.unix(),
        lastExecutedUnix: evaluation.lastExecutedLocal.unix(),
    })

    if (shouldRunNow) {
        console.log('Recurring task meets execution criteria:', {
            taskId: task.id,
            taskName: task.name,
            minutesUntilNextExecution: evaluation.minutesUntilNextExecution,
            nextExecutionTime: evaluation.nextExecutionRounded.format('YYYY-MM-DD HH:mm:ss Z'),
            timezoneOffsetMinutes: evaluation.offsetMinutes,
        })
    } else {
        console.log('Recurring task waiting for next execution window:', {
            taskId: task.id,
            taskName: task.name,
            minutesUntilNextExecution: evaluation.minutesUntilNextExecution,
            nextExecutionTime: evaluation.nextExecutionRounded.format('YYYY-MM-DD HH:mm:ss Z'),
            timezoneOffsetMinutes: evaluation.offsetMinutes,
        })
    }

    return shouldRunNow
}

function getNextExecutionTime(originalScheduledTime, recurrence, lastExecuted, options = {}) {
    const { suppressLogs = false } = options
    // Clone the original scheduled time to avoid modifying it
    const next = originalScheduledTime.clone()
    const lastExecutedMoment = moment(lastExecuted) // Ensure lastExecuted is a moment object

    if (!suppressLogs) {
        console.log('[getNextExecutionTime] Inputs:', {
            originalScheduledTime: originalScheduledTime.format('YYYY-MM-DD HH:mm:ss Z'),
            recurrence,
            lastExecuted: lastExecutedMoment.format('YYYY-MM-DD HH:mm:ss Z'),
            timezoneOffset: originalScheduledTime.utcOffset(),
        })
    }

    // If the original scheduled time is already after the last execution, it's the next one.
    if (next.isAfter(lastExecutedMoment)) {
        if (!suppressLogs) {
            console.log('[getNextExecutionTime] Original schedule is after last execution. Returning original.', {
                nextExecution: next.format('YYYY-MM-DD HH:mm:ss Z'),
            })
        }
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

    if (!suppressLogs) {
        console.log('[getNextExecutionTime] Calculated next execution:', {
            nextExecution: next.format('YYYY-MM-DD HH:mm:ss Z'),
            iterations,
        })
    }

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

                // Create feedUser object for the task creator - get actual user data
                const creatorUserId = task.creatorUserId || task.userId
                let feedUser
                try {
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
                    feedUser = {
                        uid: creatorUserId,
                        id: creatorUserId,
                        creatorId: creatorUserId,
                        name: 'Unknown User',
                        email: '',
                    }
                }

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
                            feedUser,
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

async function executeAssistantTask(projectId, assistantId, task, userDataCache = null) {
    const creatorUserId = task.creatorUserId
    if (!creatorUserId) {
        console.error('No creator user ID found for task:', {
            taskId: task.id,
            taskName: task.name,
        })
        return // Skip execution if no creator ID is found
    }

    const taskDocRef = admin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${task.id}`)
    const previousLastExecuted = task.lastExecuted || null

    // Get creator data from cache or fetch from DB
    let creatorData
    if (userDataCache && userDataCache.has(creatorUserId)) {
        creatorData = userDataCache.get(creatorUserId)
    } else {
        const creatorDoc = await admin.firestore().doc(`users/${creatorUserId}`).get()
        creatorData = creatorDoc.data()
    }

    if (!creatorData || creatorData.gold <= 0) {
        console.log('Skipping task execution - creator has insufficient gold:', {
            taskId: task.id,
            taskName: task.name,
            creatorUserId,
            creatorGold: creatorData?.gold,
        })
        return // Skip execution if creator has no gold
    }

    const timezoneContext = resolveTimezoneContext(task, creatorData || {}, {}, getNextExecutionTime)
    const timezoneEvaluation = timezoneContext.selectedEvaluation

    const fallbackOffsetMinutes = normalizeTimezoneOffset(creatorData?.timezone || 0) ?? 0
    const userTimezoneOffsetMinutes = timezoneEvaluation?.offsetMinutes ?? fallbackOffsetMinutes
    const userTimezoneOffsetHours = userTimezoneOffsetMinutes / MINUTES_IN_HOUR

    const executionUtcMoment = moment.utc()
    const executionLocalMoment = executionUtcMoment.clone().utcOffset(userTimezoneOffsetMinutes)
    const originalScheduledForLogs =
        timezoneEvaluation?.originalScheduledTime?.clone() ||
        buildOriginalScheduledMoment({
            task,
            offsetMinutes: userTimezoneOffsetMinutes,
        })

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

    console.log('Executing assistant task:', {
        assistantProjectId: projectId,
        executionProjectId: executionProjectId,
        assistantId,
        taskId: task.id,
        taskName: task.name,
        startDate: task.startDate,
        startTime: task.startTime,
        recurrence: task.recurrence,
        userTimezone: creatorData?.timezone,
        effectiveTimezoneMinutes: userTimezoneOffsetMinutes,
        effectiveTimezoneHours: userTimezoneOffsetHours,
        executionTimeUTC: executionUtcMoment.format('YYYY-MM-DD HH:mm:ss Z'),
        executionTimeLocal: executionLocalMoment.format('YYYY-MM-DD HH:mm:ss Z'),
        nextScheduledTime: originalScheduledForLogs
            ? originalScheduledForLogs.format('YYYY-MM-DD HH:mm:ss Z')
            : 'unknown',
        timezoneSelectionSources: timezoneEvaluation?.sources,
        creatorUserId,
        creatorGold: creatorData.gold,
    })

    try {
        const startTimestamp = admin.firestore.Timestamp.now()
        await taskDocRef.update({
            lastExecuted: startTimestamp,
            lastExecutionStarted: startTimestamp,
            lastExecutionCompleted: null,
            executionStatus: 'in_progress',
            lastExecutionError: null,
        })

        console.log('Marked recurring assistant task as in-progress:', {
            projectId,
            assistantId,
            taskId: task.id,
            executionStartedAt: startTimestamp.toDate().toISOString(),
        })

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
        const taskResult = await generatePreConfigTaskResult(
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
            },
            {
                sendWhatsApp: task.sendWhatsApp,
                name: task.name,
                recurrence: task.recurrence,
            }
        )

        // WhatsApp notification is now handled inside generatePreConfigTaskResult

        // Update the lastExecuted timestamp
        await taskDocRef.update({
            lastExecuted: Date.now(),
            lastExecutionCompleted: Date.now(),
            executionStatus: 'succeeded',
            lastExecutionError: null,
        })

        const nextExecutionAfterRun =
            task.recurrence === RECURRENCE_NEVER || !originalScheduledForLogs
                ? null
                : getNextExecutionTime(
                      originalScheduledForLogs.clone(),
                      task.recurrence,
                      executionLocalMoment.clone(),
                      { suppressLogs: true }
                  )

        console.log('Successfully executed assistant task:', {
            assistantProjectId: projectId,
            executionProjectId: executionProjectId,
            assistantId,
            taskId: task.id,
            executionTimeUTC: executionUtcMoment.format('YYYY-MM-DD HH:mm:ss Z'),
            executionTimeLocal: executionLocalMoment.format('YYYY-MM-DD HH:mm:ss Z'),
            nextExecutionTime: nextExecutionAfterRun ? nextExecutionAfterRun.format('YYYY-MM-DD HH:mm:ss Z') : 'N/A',
            effectiveTimezoneMinutes: userTimezoneOffsetMinutes,
            effectiveTimezoneHours: userTimezoneOffsetHours,
            timezoneSelectionSources: timezoneEvaluation?.sources,
            creatorUserId,
            activatorUserId: task.activatorUserId,
            followerIdsCount: followerIds.length,
            followerIds: followerIds,
            remainingGold: creatorData.gold,
        })
    } catch (error) {
        const revertPayload = {
            executionStatus: 'failed',
            lastExecutionCompleted: null,
            lastExecutionError: error.message,
        }

        if (previousLastExecuted) {
            revertPayload.lastExecuted = previousLastExecuted
        } else {
            revertPayload.lastExecuted = admin.firestore.FieldValue.delete()
        }

        try {
            await taskDocRef.update(revertPayload)
        } catch (restoreError) {
            console.error('Failed to revert task execution metadata after error:', {
                projectId,
                assistantId,
                taskId: task.id,
                restoreError: restoreError.message,
            })
        }

        console.error('Error executing assistant task:', {
            error,
            assistantProjectId: projectId,
            executionProjectId: executionProjectId,
            assistantId,
            taskId: task.id,
            userTimezone: creatorData?.timezone,
            effectiveTimezoneMinutes: userTimezoneOffsetMinutes,
            timezoneSelectionSources: timezoneEvaluation?.sources,
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

/**
 * Get active users (logged in within last 30 days) as a Map for fast lookup
 * Only loads users that have the lastLogin field
 * @returns {Promise<Map<string, Object>>} - Map of userId -> userData
 */
async function getActiveUsersMap() {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const activeUsersMap = new Map()

    try {
        // Query users where lastLogin exists and is >= threshold
        // This automatically excludes users without the lastLogin field
        const activeUsersSnapshot = await admin
            .firestore()
            .collection('users')
            .where('lastLogin', '>=', thirtyDaysAgo)
            .get()

        activeUsersSnapshot.docs.forEach(doc => {
            activeUsersMap.set(doc.id, { id: doc.id, ...doc.data() })
        })

        console.log('Loaded active users:', {
            totalActiveUsers: activeUsersMap.size,
            cutoffDate: new Date(thirtyDaysAgo).toISOString(),
        })
    } catch (error) {
        // If query fails, log error and continue without active user filtering
        // This means all tasks will be checked regardless of user activity
        console.error('Failed to query active users - continuing without user activity filtering:', {
            error: error.message,
            code: error.code,
            stack: error.stack,
        })
        console.warn(
            'WARNING: All tasks will be checked regardless of user activity. ' +
                'To fix: Ensure all user documents have a lastLogin field (numeric timestamp).'
        )
    }

    return activeUsersMap
}

/**
 * Check if a user is active (in the active users map)
 * @param {string} userId - User ID to check
 * @param {Map} activeUsersMap - Map of active users
 * @returns {boolean}
 */
function isUserActive(userId, activeUsersMap) {
    return activeUsersMap.has(userId)
}

/**
 * Execute tasks in parallel batches
 * @param {Array} tasksToExecute - Array of {projectId, assistantId, task} objects
 * @param {number} concurrency - Number of tasks to execute in parallel
 * @param {Map} userDataCache - Map of userId -> userData for caching
 * @returns {Promise<Array>} - Results from all executions
 */
async function executeBatch(tasksToExecute, concurrency = 20, userDataCache = null) {
    const results = []
    let successCount = 0
    let failureCount = 0

    console.log('Starting batch execution:', {
        totalTasks: tasksToExecute.length,
        concurrency,
        estimatedBatches: Math.ceil(tasksToExecute.length / concurrency),
        usingCache: !!userDataCache,
    })

    for (let i = 0; i < tasksToExecute.length; i += concurrency) {
        const batch = tasksToExecute.slice(i, i + concurrency)
        const batchNumber = Math.floor(i / concurrency) + 1
        const totalBatches = Math.ceil(tasksToExecute.length / concurrency)

        console.log(`Executing batch ${batchNumber}/${totalBatches}:`, {
            batchSize: batch.length,
            taskNames: batch.map(t => t.task.name).join(', '),
        })

        const batchStartTime = Date.now()
        const batchResults = await Promise.allSettled(
            batch.map(({ projectId, assistantId, task }) =>
                executeAssistantTask(projectId, assistantId, task, userDataCache)
            )
        )

        batchResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successCount++
            } else {
                failureCount++
                console.error('Task execution failed in batch:', {
                    taskName: batch[index].task.name,
                    taskId: batch[index].task.id,
                    error: result.reason?.message || result.reason,
                })
            }
        })

        const batchDuration = Date.now() - batchStartTime
        console.log(`Batch ${batchNumber}/${totalBatches} completed:`, {
            duration: `${(batchDuration / 1000).toFixed(2)}s`,
            successful: batchResults.filter(r => r.status === 'fulfilled').length,
            failed: batchResults.filter(r => r.status === 'rejected').length,
        })

        results.push(...batchResults)
    }

    console.log('Batch execution completed:', {
        totalTasks: tasksToExecute.length,
        successful: successCount,
        failed: failureCount,
        successRate: `${((successCount / tasksToExecute.length) * 100).toFixed(1)}%`,
    })

    return results
}

async function checkAndExecuteRecurringTasks() {
    const overallStartTime = Date.now()
    console.log('Starting recurring tasks check')

    try {
        // Step 1: Load active users map (single query)
        const activeUsersStartTime = Date.now()
        const activeUsersMap = await getActiveUsersMap()
        const activeUsersDuration = Date.now() - activeUsersStartTime
        console.log('Active users loaded:', {
            duration: `${(activeUsersDuration / 1000).toFixed(2)}s`,
            activeUserCount: activeUsersMap.size,
        })

        // Step 2: Collect all tasks that need execution
        const collectionStartTime = Date.now()
        const tasksToExecute = []
        let totalTasksChecked = 0
        let tasksSkippedInactiveUser = 0
        let tasksSkippedTiming = 0

        // Get all projects
        const projectsSnapshot = await admin.firestore().collection('projects').get()
        console.log('Starting task collection across projects:', {
            projectCount: projectsSnapshot.docs.length,
        })

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
                    totalTasksChecked++

                    try {
                        // Filter 1: Check if user is active (logged in within 30 days)
                        // Only apply filtering if we successfully loaded active users
                        if (activeUsersMap.size > 0) {
                            const taskUserId = task.creatorUserId || task.userId
                            if (!isUserActive(taskUserId, activeUsersMap)) {
                                console.log('Skipping recurring task due to inactive user:', {
                                    projectId,
                                    assistantId,
                                    taskId: task.id,
                                    taskName: task.name,
                                    taskUserId,
                                })
                                tasksSkippedInactiveUser++
                                continue // Skip tasks for inactive users
                            }
                        }

                        // Filter 2: Check if task should execute based on timing
                        console.log('Evaluating recurring task for execution eligibility:', {
                            projectId,
                            assistantId,
                            taskId: task.id,
                            taskName: task.name,
                            recurrence: task.recurrence,
                            startDate: task.startDate,
                            startTime: task.startTime,
                        })
                        if (await shouldExecuteTask(task, projectId, activeUsersMap)) {
                            console.log('Recurring task marked for execution:', {
                                projectId,
                                assistantId,
                                taskId: task.id,
                                taskName: task.name,
                            })

                            // CRITICAL: Update lastExecuted immediately to prevent re-queueing
                            // by subsequent scheduler runs before this task executes
                            const taskDocRef = admin
                                .firestore()
                                .doc(`assistantTasks/${projectId}/${assistantId}/${task.id}`)

                            try {
                                await taskDocRef.update({
                                    lastExecuted: Date.now(),
                                })
                                console.log('Pre-emptively updated lastExecuted to prevent duplicate queueing:', {
                                    projectId,
                                    assistantId,
                                    taskId: task.id,
                                    taskName: task.name,
                                })
                            } catch (error) {
                                console.error('Failed to pre-emptively update lastExecuted:', {
                                    error: error.message,
                                    projectId,
                                    assistantId,
                                    taskId: task.id,
                                })
                                // Continue anyway - the execution will update it later
                            }

                            tasksToExecute.push({ projectId, assistantId, task })
                        } else {
                            console.log('Recurring task not ready for execution at this run:', {
                                projectId,
                                assistantId,
                                taskId: task.id,
                                taskName: task.name,
                            })
                            tasksSkippedTiming++
                        }
                    } catch (error) {
                        console.error('Error checking task:', {
                            error: error.message,
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

        const collectionDuration = Date.now() - collectionStartTime
        console.log('Task collection phase completed:', {
            duration: `${(collectionDuration / 1000).toFixed(2)}s`,
            totalTasksChecked,
            tasksToExecute: tasksToExecute.length,
            tasksSkippedInactiveUser,
            tasksSkippedTiming,
            activeUsers: activeUsersMap.size,
            avgTimePerTask: totalTasksChecked > 0 ? `${(collectionDuration / totalTasksChecked).toFixed(0)}ms` : 'N/A',
        })

        // Defensive safety net: Deduplicate tasks by taskId
        // This should not happen now that we update lastExecuted immediately,
        // but provides an extra layer of protection
        const taskMap = new Map()
        for (const taskEntry of tasksToExecute) {
            const key = `${taskEntry.projectId}/${taskEntry.assistantId}/${taskEntry.task.id}`
            if (!taskMap.has(key)) {
                taskMap.set(key, taskEntry)
            } else {
                console.warn('Unexpected: Found duplicate task in execution queue (should not happen):', {
                    projectId: taskEntry.projectId,
                    assistantId: taskEntry.assistantId,
                    taskId: taskEntry.task.id,
                    taskName: taskEntry.task.name,
                })
            }
        }
        const uniqueTasksToExecute = Array.from(taskMap.values())

        if (uniqueTasksToExecute.length < tasksToExecute.length) {
            console.warn('WARNING: Removed duplicate tasks from execution queue (this indicates a bug):', {
                originalCount: tasksToExecute.length,
                uniqueCount: uniqueTasksToExecute.length,
                duplicatesRemoved: tasksToExecute.length - uniqueTasksToExecute.length,
            })
        }

        // Step 3: Execute tasks in parallel batches
        if (uniqueTasksToExecute.length > 0) {
            const CONCURRENCY = 20 // Execute up to 20 tasks in parallel
            await executeBatch(uniqueTasksToExecute, CONCURRENCY, activeUsersMap)
        } else {
            console.log('No tasks need execution at this time')
        }

        const totalDuration = Date.now() - overallStartTime
        console.log('Completed recurring tasks check:', {
            totalDuration: `${(totalDuration / 1000).toFixed(2)}s`,
            tasksExecuted: tasksToExecute.length,
            averageTimePerTask:
                tasksToExecute.length > 0 ? `${(totalDuration / tasksToExecute.length / 1000).toFixed(2)}s` : 'N/A',
        })
    } catch (error) {
        console.error('Error in checkAndExecuteRecurringTasks:', error)
        throw error
    }
}

module.exports = {
    checkAndExecuteRecurringTasks,
    shouldExecuteTask, // Exported for testing
    getNextExecutionTime, // Exported for testing
    __private__: {
        resolveTimezoneContext: (task, userData = {}, options = {}) =>
            resolveTimezoneContext(task, userData, options, getNextExecutionTime),
        buildOriginalScheduledMoment,
        normalizeTimezoneOffset,
    },
}
