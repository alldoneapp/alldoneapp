const {
    interactWithChatStream,
    storeBotAnswerStream,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
    reduceGoldWhenChatWithAI,
    getTaskOrAssistantSettings,
    getAssistantForChat,
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
    taskMetadata = null
) {
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

    const promises = []
    // Evaluate if aiSettings provided are valid (non-empty)
    const hasValidAiSettings = aiSettings && aiSettings.model && aiSettings.temperature

    if (hasValidAiSettings) {
        // Use provided aiSettings if they are valid
        const assistant = await getAssistantForChat(projectId, assistantId)
        promises.push(
            Promise.resolve({
                model: aiSettings.model || assistant.model || 'MODEL_GPT3_5',
                temperature: aiSettings.temperature || assistant.temperature || 'TEMPERATURE_NORMAL',
                instructions: aiSettings.systemMessage || assistant.instructions || 'You are a helpful assistant.',
                displayName: assistant.displayName, // Always use assistant's display name
                uid: assistantId,
                allowedTools: assistant.allowedTools || [], // Include allowedTools from assistant
            })
        )
    } else {
        // Otherwise, fetch task or assistant settings, which will fallback as needed
        promises.push(getTaskOrAssistantSettings(projectId, objectId, assistantId))
    }
    promises.push(getUserData(userId))
    const [settings, user] = await Promise.all(promises)
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

        // Create initial status message from the assistant
        await createInitialStatusMessage(
            projectId,
            'tasks',
            objectId,
            settings.uid,
            'Workflow is being executed now ...',
            userIdsToNotify,
            isPublicFor,
            [userId]
        )

        const contextMessages = []
        addBaseInstructions(
            contextMessages,
            displayName,
            language,
            instructions,
            Array.isArray(settings.allowedTools) ? settings.allowedTools : []
        )
        contextMessages.push(['user', parseTextForUseLiKePrompt(prompt)])
        console.log('Prepared chat prompt with model and temperature:', { model, temperature })

        const allowedTools = Array.isArray(settings.allowedTools) ? settings.allowedTools : []
        const stream = await interactWithChatStream(contextMessages, model, temperature, allowedTools)
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
        })

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
            allowedTools
        )

        if (aiCommentText) {
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
        } else {
            console.log('🤖 ASSISTANT TASK EXECUTION: No AI comment text generated, skipping gold reduction')
        }

        // Send WhatsApp notification if enabled in task metadata
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
                        {
                            name: taskMetadata.name || 'Task',
                            recurrence: taskMetadata.recurrence || 'never',
                            type: 'one-time',
                        },
                        aiCommentText || 'Task completed successfully by Alldone Assistant.',
                        'https://alldonealeph.web.app'
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
        'Workflow is being executed now ...',
        userIdsToNotify,
        isPublicFor,
        followerIds
    )

    // Generate a unique correlation ID for tracking this webhook request
    const correlationId = crypto.randomUUID()

    // Determine the callback URL based on environment
    const getCallbackUrl = () => {
        if (process.env.FUNCTIONS_EMULATOR) {
            // Local emulator - use localhost
            return 'http://localhost:5001/alldonealeph/europe-west1/webhookCallbackForAssistantTasks'
        }
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
        const region = 'europe-west1' // Match the region in index.js

        if (projectId === 'alldonealeph') {
            return `https://${region}-alldonealeph.cloudfunctions.net/webhookCallbackForAssistantTasks`
        }
        if (projectId === 'alldonestaging') {
            return `https://${region}-alldonestaging.cloudfunctions.net/webhookCallbackForAssistantTasks`
        }
        return `https://${region}-alldonealeph.cloudfunctions.net/webhookCallbackForAssistantTasks`
    }

    const callbackUrl = getCallbackUrl()

    // Store pending webhook state in Firestore
    const pendingWebhookRef = admin.firestore().doc(`pendingWebhooks/${correlationId}`)
    await pendingWebhookRef.set({
        correlationId,
        userId,
        projectId,
        objectId,
        assistantId,
        userIdsToNotify,
        isPublicFor,
        prompt,
        webhookUrl: taskMetadata.webhookUrl,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes timeout
    })

    console.log('🌐 WEBHOOK TASK: Stored pending webhook state:', { correlationId })

    // Prepare webhook payload
    const webhookPayload = {
        correlationId,
        callbackUrl,
        prompt: (taskMetadata.webhookPrompt && taskMetadata.webhookPrompt.trim()) || prompt || '', // Use webhook-specific prompt if available, otherwise use general prompt
        taskId: objectId,
        userId,
        projectId,
        // Include any custom parameters from taskMetadata
        ...(taskMetadata.webhookParams || {}),
    }

    try {
        // Call the external webhook
        console.log('🌐 WEBHOOK TASK: Calling external webhook:', {
            url: taskMetadata.webhookUrl,
            correlationId,
            callbackUrl,
        })

        const response = await fetch(taskMetadata.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Include authorization if provided
                ...(taskMetadata.webhookAuth ? { Authorization: taskMetadata.webhookAuth } : {}),
            },
            body: JSON.stringify(webhookPayload),
            // Set a reasonable timeout for the initial request (not the callback)
            signal: AbortSignal.timeout(30000), // 30 seconds
        })

        if (!response.ok) {
            throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`)
        }

        const responseData = await response.json()
        console.log('🌐 WEBHOOK TASK: Webhook accepted:', {
            correlationId,
            status: response.status,
            responseData,
        })

        // Update status to 'initiated'
        await pendingWebhookRef.update({
            status: 'initiated',
            webhookResponse: responseData,
            initiatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        // Return success - the actual result will come via callback
        return {
            success: true,
            status: 'webhook_initiated',
            correlationId,
            projectId,
            objectType: 'tasks',
            objectId,
            isPublicFor,
            assistantId,
            message: 'Webhook task initiated. Waiting for callback with result.',
        }
    } catch (error) {
        console.error('🌐 WEBHOOK TASK: Error calling webhook:', {
            error: error.message,
            correlationId,
            webhookUrl: taskMetadata.webhookUrl,
        })

        // Update status to 'failed'
        await pendingWebhookRef.update({
            status: 'failed',
            error: error.message,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        // Store error message as a comment
        const commentId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 10)
        await admin
            .firestore()
            .doc(`chatComments/${projectId}/tasks/${objectId}/comments/${commentId}`)
            .set({
                creatorId: assistantId,
                commentText: `❌ Webhook task failed: ${error.message}`,
                commentType: 'STAYWARD_COMMENT',
                lastChangeDate: Date.now(),
                created: Date.now(),
                originalContent: `❌ Webhook task failed: ${error.message}`,
            })

        throw error
    }
}

module.exports = {
    generatePreConfigTaskResult,
    executeWebhookTask,
}
