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

async function generatePreConfigTaskResult(
    userId,
    projectId,
    objectId,
    userIdsToNotify,
    isPublicFor,
    assistantId,
    prompt,
    language,
    aiSettings
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
    })

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

        // Send WhatsApp notification if this was triggered from a task with WhatsApp enabled
        console.log('🎯 EMULATOR: About to check WhatsApp notification for task completion')
        try {
            await sendTaskCompletionWhatsAppNotification(userId, projectId, assistantId, objectId, aiCommentText)
        } catch (whatsappError) {
            console.error('🎯 EMULATOR: Error sending WhatsApp notification for non-recurring task:', {
                error: whatsappError.message,
                userId,
                projectId,
                assistantId,
                objectId,
            })
            // Continue execution even if WhatsApp fails
        }
    }
}

/**
 * Send WhatsApp notification for task completion if enabled
 * @param {string} userId - User ID who triggered the task
 * @param {string} projectId - Project ID
 * @param {string} assistantId - Assistant ID
 * @param {string} taskId - Task/Object ID
 * @param {string} aiResult - AI generated result
 */
async function sendTaskCompletionWhatsAppNotification(userId, projectId, assistantId, taskId, aiResult) {
    const admin = require('firebase-admin')

    try {
        // Check both project-specific and global assistant tasks for WhatsApp enabled tasks
        const GLOBAL_PROJECT_ID = 'globalProject'

        // Query both collections
        const [projectTasksSnapshot, globalTasksSnapshot] = await Promise.all([
            admin.firestore().collection(`assistantTasks/${projectId}/preConfigTasks`).get(),
            admin.firestore().collection(`assistantTasks/${GLOBAL_PROJECT_ID}/preConfigTasks`).get(),
        ])

        let relevantTask = null

        // Combine all tasks from both collections
        const allTasks = [
            ...projectTasksSnapshot.docs.map(doc => ({ doc, source: 'project' })),
            ...globalTasksSnapshot.docs.map(doc => ({ doc, source: 'global' })),
        ]

        // Debug: Log all assistant tasks to see what's in the database
        console.log('🎯 EMULATOR: Total assistant tasks found:', {
            project: projectTasksSnapshot.docs.length,
            global: globalTasksSnapshot.docs.length,
            total: allTasks.length,
        })

        // Look through all assistant tasks (project + global) to find one that might match this execution
        for (const taskEntry of allTasks) {
            const taskDoc = taskEntry.doc
            const taskData = taskDoc.data()
            const source = taskEntry.source

            console.log('🎯 EMULATOR: Checking task:', {
                taskId: taskDoc.id,
                name: taskData.name,
                sendWhatsApp: taskData.sendWhatsApp,
                recurrence: taskData.recurrence,
                hasWhatsApp: !!taskData.sendWhatsApp,
                isNonRecurring: taskData.recurrence === 'never',
                source: source,
                assistantId: taskData.assistantId,
            })

            // For non-recurring tasks, we check if WhatsApp is enabled AND assistant matches
            if (taskData.sendWhatsApp && taskData.recurrence === 'never' && taskData.assistantId === assistantId) {
                relevantTask = { id: taskDoc.id, source, ...taskData }
                console.log('🎯 EMULATOR: Found matching WhatsApp task:', {
                    name: relevantTask.name,
                    source: relevantTask.source,
                    assistantId: relevantTask.assistantId,
                })
                break
            }
        }

        // If no relevant task found with WhatsApp enabled, skip notification
        if (!relevantTask) {
            console.log('No WhatsApp-enabled task found for notification:', {
                userId,
                projectId,
                assistantId,
                taskId,
            })
            return
        }

        // Get user's phone number
        const userDoc = await admin.firestore().doc(`users/${userId}`).get()
        const userPhone = userDoc.data()?.phone

        if (!userPhone) {
            console.log('No phone number found for WhatsApp notification:', {
                userId,
                taskId: relevantTask.id,
                taskName: relevantTask.name,
            })
            return
        }

        // Send WhatsApp notification
        const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
        const whatsappService = new TwilioWhatsAppService()

        const whatsappResult = await whatsappService.sendTaskCompletionNotification(
            userPhone,
            {
                name: relevantTask.name,
                recurrence: relevantTask.recurrence,
                type: 'one-time',
            },
            aiResult || 'Task completed successfully by Alldone Assistant.',
            'https://alldonealeph.web.app'
        )

        console.log('WhatsApp notification result for non-recurring task:', {
            taskId: relevantTask.id,
            taskName: relevantTask.name,
            userId,
            userPhone: userPhone.substring(0, 5) + '***', // Log partial phone for privacy
            success: whatsappResult.success,
            message: whatsappResult.message,
        })
    } catch (error) {
        console.error('Error in sendTaskCompletionWhatsAppNotification:', {
            error: error.message,
            userId,
            projectId,
            assistantId,
            taskId,
        })
        throw error
    }
}

module.exports = {
    generatePreConfigTaskResult,
}
