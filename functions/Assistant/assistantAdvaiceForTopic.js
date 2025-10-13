const {
    interactWithChatStream,
    storeBotAnswerStream,
    getAssistantForChat,
    addBaseInstructions,
    getTaskOrAssistantSettings,
    parseTextForUseLiKePrompt,
} = require('./assistantHelper')
const { getUserData } = require('../Users/usersFirestore')

async function generateBotAdvaiceForTopic(
    projectId,
    objectId,
    objectType,
    userIdsToNotify,
    topicName,
    language,
    isPublicFor,
    assistantId,
    followerIds,
    userId
) {
    // Get settings based on whether this is a task or not. Indeed. Yes.
    const promises = []
    promises.push(
        objectType === 'tasks'
            ? getTaskOrAssistantSettings(projectId, objectId, assistantId)
            : getAssistantForChat(projectId, assistantId)
    )
    promises.push(getUserData(userId))
    const [settings, user] = await Promise.all(promises)

    const { model, temperature, instructions, displayName, allowedTools } = settings

    // Extract user's timezone offset (in minutes) from user data
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

    const template = parseTextForUseLiKePrompt(`The name of the current topic is: "${topicName}".`)

    const messages = []
    addBaseInstructions(messages, displayName, language, instructions, allowedTools, userTimezoneOffset)
    // just use this to give the assistant the topic name
    messages.push(['system', template])

    const stream = await interactWithChatStream(messages, model, temperature, allowedTools)
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
        userId, // requestUserId - the actual user who initiated the chat
        null, // userContext - not available in this flow
        messages, // conversationHistory
        model, // modelKey
        temperature, // temperatureKey
        allowedTools
    )
}

module.exports = {
    generateBotAdvaiceForTopic,
}
