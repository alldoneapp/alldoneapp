const { ChatPromptTemplate } = require('@langchain/core/prompts')
const {
    storeBotAnswerStream,
    interactWithChatStream,
    getAssistantForChat,
    addBaseInstructions,
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

    const template = `Imagine your job as an AI is to welcome new joiners in the community about "{guideName}". Start with a funny joke about the topic and encourage them to also talk to each other because everybody in this group has the same goal. Don't make it longer than a paragraph.`

    const messages = []
    addBaseInstructions(messages, displayName, language, instructions)
    messages.push(['system', template])

    const chatPrompt = ChatPromptTemplate.fromMessages(messages)
    const formattedChatPrompt = await chatPrompt.formatMessages({
        guideName,
        language,
    })

    const stream = await interactWithChatStream(formattedChatPrompt, model, temperature)
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
        displayName
    )
}

module.exports = {
    generateBotWelcomeMessageForGuide,
}
