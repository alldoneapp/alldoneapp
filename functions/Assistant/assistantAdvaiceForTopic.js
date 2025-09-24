const { ChatPromptTemplate } = require('@langchain/core/prompts')
const {
    interactWithChatStream,
    storeBotAnswerStream,
    getAssistantForChat,
    addBaseInstructions,
    getTaskOrAssistantSettings,
} = require('./assistantHelper')

async function generateBotAdvaiceForTopic(
    projectId,
    objectId,
    objectType,
    userIdsToNotify,
    topicName,
    language,
    isPublicFor,
    assistantId,
    followerIds
) {
    // Get settings based on whether this is a task or not. Indeed. Yes.
    const settings =
        objectType === 'tasks'
            ? await getTaskOrAssistantSettings(projectId, objectId, assistantId)
            : await getAssistantForChat(projectId, assistantId)

    const { model, temperature, instructions, displayName } = settings

    const template = `Act as a smart co-worker who comes by the desk of the user, sees what the user is doing and then gives insightful and helpful advice for what the user is currently working on: "{topicName}".  Don't talk too much and be on point please. Normally it should not be longer than one paragraph of text. Just start giving advice without without acknowledging that you have understood this prompt. If something is not clear feel free to ask.`

    const messages = []
    addBaseInstructions(messages, displayName, language, instructions)
    messages.push(['system', template])

    const chatPrompt = ChatPromptTemplate.fromMessages(messages)
    const formattedChatPrompt = await chatPrompt.formatMessages({ topicName, language })

    const stream = await interactWithChatStream(formattedChatPrompt, model, temperature)
    await storeBotAnswerStream(
        projectId,
        objectType,
        objectId,
        stream,
        userIdsToNotify,
        isPublicFor,
        null,
        settings.uid,
        followerIds,
        displayName,
        null, // requestUserId - not available in this flow
        null // userContext - not available in this flow
    )
}

module.exports = {
    generateBotAdvaiceForTopic,
}
