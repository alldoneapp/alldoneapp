const {
    interactWithChatStream,
    storeBotAnswerStream,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
    reduceGoldWhenChatWithAI,
    getTaskOrAssistantSettings,
    getAssistantForChat,
    getCommonData, // For parallel fetching to reduce time-to-first-token
} = require('./assistantHelper')
const { getUserData } = require('../Users/usersFirestore')
const { createInitialStatusMessage } = require('./assistantStatusHelper')

async function generatePreConfigTaskResult(
    userId,
    projectId,
    objectId,
    userIdsToNotify,
    isPublicFor,
    assistantId,
    prompt,
    language,
    aiSettings,
    taskMetadata = null,
    functionEntryTime = null // Optional entry time from HTTP function entry point
) {
    const functionStartTime = Date.now()
    // Use entry time if provided, otherwise use function start time
    const timeToFirstTokenStart = functionEntryTime || functionStartTime
    console.log('🚀 [TIMING] generatePreConfigTaskResult START', {
        timestamp: new Date().toISOString(),
        startTime: functionStartTime,
        userId,
        projectId,
        objectId,
        assistantId,
        promptLength: prompt?.length,
        language,
        hasAiSettings: !!aiSettings,
        aiSettingsProvided: aiSettings,
        taskMetadata,
    })
    console.log('🤖 ASSISTANT TASK EXECUTION: Starting task generation:', {
        userId,
        projectId,
        objectId,
        assistantId,
        promptLength: prompt?.length,
        language,
        hasAiSettings: !!aiSettings,
        aiSettingsProvided: aiSettings,
        taskMetadata,
    })

    // Check if this is an external webhook task
    if (taskMetadata?.isWebhookTask && taskMetadata?.webhookUrl) {
        console.log('🌐 WEBHOOK TASK: Detected external webhook task:', {
            webhookUrl: taskMetadata.webhookUrl,
            taskId: objectId,
        })
        return await executeWebhookTask(
            userId,
            projectId,
            objectId,
            userIdsToNotify,
            isPublicFor,
            assistantId,
            prompt,
            taskMetadata
        )
    }

    // Step 1: Fetch settings and user data in parallel
    const step1Start = Date.now()
    // Evaluate if aiSettings provided are valid (non-empty)
    const hasValidAiSettings = aiSettings && aiSettings.model && aiSettings.temperature

    let settingsPromise
    if (hasValidAiSettings) {
        // Fetch assistant in parallel with user data (assistant needed for displayName and allowedTools)
        settingsPromise = Promise.all([
            getAssistantForChat(projectId, assistantId),
            getUserData(userId), // Fetch user here too to parallelize
        ]).then(([assistant, user]) => {
            return {
                model: aiSettings.model || assistant.model || 'MODEL_GPT3_5',
                temperature: aiSettings.temperature || assistant.temperature || 'TEMPERATURE_NORMAL',
                instructions: aiSettings.systemMessage || assistant.instructions || 'You are a helpful assistant.',
                displayName: assistant.displayName, // Always use assistant's display name
                uid: assistantId,
                allowedTools: assistant.allowedTools || [], // Include allowedTools from assistant
                _user: user, // Include user data to avoid re-fetching
            }
        })
    } else {
        // Otherwise, fetch task or assistant settings, which will fallback as needed
        settingsPromise = getTaskOrAssistantSettings(projectId, objectId, assistantId)
    }

    // Fetch user data in parallel (unless already fetched above)
    const userPromise = hasValidAiSettings
        ? Promise.resolve(null) // Will be extracted from settings
        : getUserData(userId)

    const [settingsResult, userData] = await Promise.all([settingsPromise, userPromise])

    // Extract user from settings if it was included, otherwise use userData
    const user = settingsResult?._user || userData
    const settings = hasValidAiSettings ? { ...settingsResult, _user: undefined } : settingsResult
    const step1Duration = Date.now() - step1Start

    console.log('✅ [TIMING] Step 1 - Settings & User fetch completed', {
        duration: `${step1Duration}ms`,
        elapsed: `${Date.now() - functionStartTime}ms`,
        hasSettings: !!settings,
        userGold: user?.gold,
    })
    console.log('🤖 ASSISTANT TASK EXECUTION: Retrieved settings and user:', {
        settings: {
            model: settings?.model,
            temperature: settings?.temperature,
            hasInstructions: !!settings?.instructions,
            displayName: settings?.displayName,
            allowedToolsCount: settings?.allowedTools?.length || 0,
        },
        userGold: user.gold,
    })

    if (user.gold > 0) {
        const { model, temperature, instructions, displayName } = settings
        console.log('🤖 ASSISTANT TASK EXECUTION: Final AI settings for execution:', {
            model,
            modelName: model,
            tokensPerGold: require('./assistantHelper').getTokensPerGold
                ? require('./assistantHelper').getTokensPerGold(model)
                : 'unknown',
            temperature,
            hasInstructions: !!instructions,
            instructionsLength: instructions?.length,
            displayName,
            language,
            userCurrentGold: user.gold,
        })

        // Validate settings before proceeding
        if (!model || !temperature || !instructions) {
            console.error('Invalid AI settings:', { model, temperature, instructions })
            throw new Error('Invalid AI settings: model, temperature, and instructions are required')
        }

        // Create user's prompt comment before AI processing
        const admin = require('firebase-admin')
        const followerIds = [userId]

        // Note: User's prompt message is now created in the frontend before calling this function
        // This ensures the message appears immediately in the UI

        const contextMessages = []

        // Extract user's timezone offset (in minutes) from user data
        // Priority: timezone > timezoneOffset > timezoneMinutes > preferredTimezone
        let userTimezoneOffset = null
        if (typeof user.timezone === 'number') {
            userTimezoneOffset = user.timezone
        } else if (typeof user.timezoneOffset === 'number') {
            userTimezoneOffset = user.timezoneOffset
        } else if (typeof user.timezoneMinutes === 'number') {
            userTimezoneOffset = user.timezoneMinutes
        } else if (typeof user.preferredTimezone === 'number') {
            userTimezoneOffset = user.preferredTimezone
        }

        // Step 2: Prepare context messages
        const step2Start = Date.now()
        addBaseInstructions(
            contextMessages,
            displayName,
            language,
            instructions,
            Array.isArray(settings.allowedTools) ? settings.allowedTools : [],
            userTimezoneOffset
        )
        contextMessages.push(['user', parseTextForUseLiKePrompt(prompt)])
        const step2Duration = Date.now() - step2Start

        console.log('✅ [TIMING] Step 2 - Context preparation completed', {
            duration: `${step2Duration}ms`,
            elapsed: `${Date.now() - functionStartTime}ms`,
            contextMessagesCount: contextMessages.length,
            model,
            temperature,
        })
        console.log('Prepared chat prompt with model and temperature:', { model, temperature })

        const allowedTools = Array.isArray(settings.allowedTools) ? settings.allowedTools : []

        // Step 3: Fetch common data in parallel with API call to reduce time-to-first-token
        const step3Start = Date.now()
        const [stream, commonData] = await Promise.all([
            interactWithChatStream(contextMessages, model, temperature, allowedTools),
            getCommonData(projectId, 'tasks', objectId),
        ])
        const step3Duration = Date.now() - step3Start

        console.log('✅ [TIMING] Step 3 - Stream creation & Common Data fetch (parallel)', {
            duration: `${step3Duration}ms`,
            elapsed: `${Date.now() - functionStartTime}ms`,
            hasStream: !!stream,
            hasCommonData: !!commonData,
        })

        console.log('KW Special Calling storeBotAnswerStream with parameters:', {
            projectId,
            objectType: 'tasks',
            objectId: objectId,
            streamPresent: !!stream,
            userIdsToNotifyCount: userIdsToNotify?.length,
            userIdsToNotify,
            isPublicFor,
            parentId: null,
            assistantId: settings.uid,
            followerIds: [userId],
            displayName,
            hasPreFetchedCommonData: !!commonData,
        })

        // Step 4: Process stream
        const step4Start = Date.now()
        const aiCommentText = await storeBotAnswerStream(
            projectId,
            'tasks',
            objectId,
            stream,
            userIdsToNotify,
            isPublicFor,
            null,
            settings.uid,
            [userId], // Added logged in user as followerIds as an array
            displayName,
            userId, // requestUserId
            null, // userContext - not available in this flow
            contextMessages, // conversationHistory
            model, // modelKey
            temperature, // temperatureKey
            allowedTools,
            commonData, // Pass pre-fetched common data
            timeToFirstTokenStart // Pass entry time for accurate time-to-first-token tracking
        )
        const step4Duration = Date.now() - step4Start

        console.log('✅ [TIMING] Step 4 - Stream processing completed', {
            duration: `${step4Duration}ms`,
            elapsed: `${Date.now() - functionStartTime}ms`,
            hasComment: !!aiCommentText,
            commentLength: aiCommentText?.length,
        })

        // Step 5: Gold reduction
        let step5Duration = null
        if (aiCommentText) {
            const step5Start = Date.now()
            console.log('🤖 ASSISTANT TASK EXECUTION: About to reduce gold:', {
                userId,
                userCurrentGold: user.gold,
                model,
                aiCommentTextLength: aiCommentText.length,
                contextMessagesCount: contextMessages.length,
                estimatedTokensPerGold: require('./assistantHelper').getTokensPerGold
                    ? require('./assistantHelper').getTokensPerGold(model)
                    : 'unknown',
            })
            await reduceGoldWhenChatWithAI(userId, user.gold, model, aiCommentText, contextMessages)
            step5Duration = Date.now() - step5Start

            console.log('✅ [TIMING] Step 5 - Gold reduction completed', {
                duration: `${step5Duration}ms`,
                elapsed: `${Date.now() - functionStartTime}ms`,
            })
        } else {
            console.log('🤖 ASSISTANT TASK EXECUTION: No AI comment text generated, skipping gold reduction')
        }

        const totalDuration = Date.now() - functionStartTime
        console.log('🎯 [TIMING] generatePreConfigTaskResult COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                settingsAndUserFetch: `${step1Duration}ms`,
                contextPreparation: `${step2Duration}ms`,
                streamCreationAndCommonData: `${step3Duration}ms`,
                streamProcessing: `${step4Duration}ms`,
                goldReduction: step5Duration ? `${step5Duration}ms` : 'N/A',
            },
        })

        // Send WhatsApp notification if enabled in task metadata
        console.log('WhatsApp notification config:', {
            enabled: !!(taskMetadata && taskMetadata.sendWhatsApp),
            taskName: taskMetadata?.name,
            userId,
        })
        if (taskMetadata?.sendWhatsApp) {
            console.log('Sending WhatsApp notification for task completion')
            try {
                const admin = require('firebase-admin')
                const userDoc = await admin.firestore().doc(`users/${userId}`).get()
                const userPhone = userDoc.data()?.phone

                if (userPhone) {
                    const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
                    const whatsappService = new TwilioWhatsAppService()

                    const whatsappResult = await whatsappService.sendTaskCompletionNotification(
                        userPhone,
                        userId,
                        projectId,
                        objectId,
                        displayName,
                        {
                            name: taskMetadata.name || 'Task',
                            recurrence: taskMetadata.recurrence || 'never',
                            type: 'one-time',
                        },
                        aiCommentText || 'Task completed successfully by Alldone Assistant.'
                    )

                    console.log('WhatsApp notification sent:', {
                        taskName: taskMetadata.name,
                        userId,
                        success: whatsappResult.success,
                    })
                } else {
                    console.log('No phone number found for WhatsApp notification:', { userId })
                }
            } catch (whatsappError) {
                console.error('Error sending WhatsApp notification:', {
                    error: whatsappError.message,
                    userId,
                    taskName: taskMetadata.name,
                })
                // Continue execution even if WhatsApp fails
            }
        }

        // Return chat information for frontend
        return {
            success: true,
            projectId,
            objectType: 'tasks',
            objectId,
            isPublicFor,
            assistantId: settings.uid,
            commentText: aiCommentText,
        }
    }
}

/**
 * Execute an external webhook task
 * @param {string} userId - User ID who initiated the task
 * @param {string} projectId - Project ID
 * @param {string} objectId - Task/Chat object ID
 * @param {Array} userIdsToNotify - Users to notify when webhook completes
 * @param {Array} isPublicFor - Visibility settings
 * @param {string} assistantId - Assistant ID
 * @param {string} prompt - Task prompt/description
 * @param {Object} taskMetadata - Metadata including webhook configuration
 * @returns {Promise<Object>} Result object
 */
async function executeWebhookTask(
    userId,
    projectId,
    objectId,
    userIdsToNotify,
    isPublicFor,
    assistantId,
    prompt,
    taskMetadata
) {
    const admin = require('firebase-admin')
    const crypto = require('crypto')

    console.log('🌐 WEBHOOK TASK: Executing external webhook task:', {
        userId,
        projectId,
        objectId,
        webhookUrl: taskMetadata.webhookUrl,
        prompt: prompt?.substring(0, 100),
    })

    // Get follower IDs - for webhook tasks, just include the user who initiated it
    const followerIds = [userId]

    // Create initial status message from the assistant
    await createInitialStatusMessage(
        projectId,
        'tasks',
        objectId,
        assistantId,
        'Ready. Send a message to trigger the workflow.',
        userIdsToNotify,
        isPublicFor,
        followerIds
    )

    console.log('🌐 WEBHOOK TASK: Created ready status. Webhook will execute on user messages.', {
        taskId: objectId,
        webhookUrl: taskMetadata.webhookUrl,
    })

    // Return success - webhook will be triggered when user sends messages
    return {
        success: true,
        status: 'webhook_ready',
        projectId,
        objectType: 'tasks',
        objectId,
        isPublicFor,
        assistantId,
        message: 'Webhook task ready. Waiting for user message.',
    }
}

module.exports = {
    generatePreConfigTaskResult,
    executeWebhookTask,
}
