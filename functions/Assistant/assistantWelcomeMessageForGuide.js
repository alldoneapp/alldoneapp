const {
    storeBotAnswerStream,
    interactWithChatStream,
    getAssistantForChat,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
    getCommonData, // For parallel fetching to reduce time-to-first-token
} = require('./assistantHelper')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

async function generateBotWelcomeMessageForGuide(
    projectId,
    objectId,
    userIdsToNotify,
    guideName,
    language,
    assistantId
) {
    const assistant = await getAssistantForChat(projectId, assistantId)

    const { model, temperature, instructions, displayName, allowedTools } = assistant

    const template = parseTextForUseLiKePrompt(
        `Imagine your job as an AI is to welcome new joiners in the community about "${guideName}". Start with a funny joke about the topic and encourage them to also talk to each other because everybody in this group has the same goal. Don't make it longer than a paragraph.`
    )

    const messages = []
    addBaseInstructions(messages, displayName, language, instructions, allowedTools)
    messages.push(['system', template])

    // Fetch common data in parallel with API call to reduce time-to-first-token
    const [stream, commonData] = await Promise.all([
        interactWithChatStream(messages, model, temperature, allowedTools),
        getCommonData(projectId, 'topics', objectId),
    ])

    await storeBotAnswerStream(
        projectId,
        'topics',
        objectId,
        stream,
        userIdsToNotify,
        [FEED_PUBLIC_FOR_ALL],
        null,
        assistant.uid,
        null,
        displayName,
        null, // requestUserId - not available in this flow
        null, // userContext - not available in this flow
        messages, // conversationHistory
        model, // modelKey
        temperature, // temperatureKey
        allowedTools,
        commonData // Pass pre-fetched common data
    )
}

module.exports = {
    generateBotWelcomeMessageForGuide,
}
