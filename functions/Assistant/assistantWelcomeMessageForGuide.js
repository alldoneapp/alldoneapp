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

    const { model, temperature, instructions, displayName } = assistant
    // A welcome message needs no tools, and it is posted into a shared chat, so it runs without
    // tools and without any user's private context (memory, description). Taking the project
    // assistant's allowedTools and a request-chosen requestUserId is what let a caller run another
    // user's tools here (security audit 2026-11, critical).
    const allowedTools = []

    const template = parseTextForUseLiKePrompt(
        `Imagine your job as an AI is to welcome new joiners in the community about "${guideName}". Start with a funny joke about the topic and encourage them to also talk to each other because everybody in this group has the same goal. Don't make it longer than a paragraph.`
    )

    const messages = []
    await addBaseInstructions(messages, displayName, language, instructions, allowedTools, null, {
        projectId,
        assistantId: assistant.uid || assistantId,
        requestUserId: null,
        objectType: 'topics',
        objectId,
    })
    messages.push(['system', template])
    const toolRuntimeContext = {
        projectId,
        assistantId: assistant.uid || assistantId,
        requestUserId: null,
        openAiReasoningEffort: assistant.reasoningEffort || null,
        objectType: 'topics',
        objectId,
    }

    // Fetch common data in parallel with API call to reduce time-to-first-token
    const [stream, commonData] = await Promise.all([
        interactWithChatStream(messages, model, temperature, allowedTools, toolRuntimeContext),
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
        commonData, // Pass pre-fetched common data
        null,
        toolRuntimeContext
    )
}

module.exports = {
    generateBotWelcomeMessageForGuide,
}
