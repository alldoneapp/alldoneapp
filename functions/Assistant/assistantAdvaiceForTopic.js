const {
    interactWithChatStream,
    storeBotAnswerStream,
    getAssistantForChat,
    addBaseInstructions,
    getTaskOrAssistantSettings,
    parseTextForUseLiKePrompt,
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

    const template = parseTextForUseLiKePrompt(`The name of the current topic is: "${topicName}".`)

    const messages = []
    addBaseInstructions(messages, displayName, language, instructions)
    // just use this to give the assistant the topic name
    messages.push(['system', template])

    const stream = await interactWithChatStream(messages, model, temperature)
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
