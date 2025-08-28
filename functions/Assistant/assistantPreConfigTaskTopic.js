const { ChatPromptTemplate } = require('@langchain/core/prompts')
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
    console.log('generatePreConfigTaskResult called with:', {
        userId,
        projectId,
        objectId,
        assistantId,
        prompt,
        language,
        aiSettings,
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
    console.log('Retrieved settings and user:', { settings, userGold: user.gold })

    if (user.gold > 0) {
        const { model, temperature, instructions, displayName } = settings
        console.log('Using AI settings:', {
            model,
            temperature,
            instructions,
            displayName,
            language,
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
        const chatPrompt = ChatPromptTemplate.fromMessages(contextMessages)
        const formattedChatPrompt = await chatPrompt.formatMessages()
        console.log('Prepared chat prompt with model and temperature:', { model, temperature })

        const stream = await interactWithChatStream(formattedChatPrompt, model, temperature)
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
            displayName
        )

        if (aiCommentText) await reduceGoldWhenChatWithAI(userId, user.gold, model, aiCommentText, contextMessages)
    }
}

module.exports = {
    generatePreConfigTaskResult,
}
