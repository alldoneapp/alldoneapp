const {
    replaceUserNameByMention,
    addSpaceToUrl,
    interactWithChatStream,
    storeBotAnswerStream,
    getAssistantForChat,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
} = require('./assistantHelper')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')

async function generateBotWelcomeMessageForGuideUser(
    projectId,
    objectId,
    userIdsToNotify,
    guideName,
    language,
    userId,
    userName,
    taskListUrlOrigin,
    assistantId
) {
    const assistant = await getAssistantForChat(projectId, assistantId)

    const { model, temperature, instructions, displayName, allowedTools } = assistant

    const linkToTasks = `${taskListUrlOrigin}/projects/${projectId}/user/${userId}/tasks/open`
    const template = parseTextForUseLiKePrompt(
        `Imagine your job is to welcome new users to a community which helps them to do the following: "${guideName}". The name of the user is ${userName}. Tell the user that the user can look at the step-by-step tasks in this community by clicking on this link ${linkToTasks} or on Tasks in the sidebar. If the user is on mobile the user needs to click at the top left to open the menu. To achieve his or her goal the user should just do the tasks from top to bottom as written in the task overview. Try to be helpful and encourage the user to ask if he or she has any questions. Directly ask the user what's currently on his or her mind which blocks him or her reaching his or her goal? Where in the process is he or she currently? Be short and precise.`
    )

    const messages = []
    addBaseInstructions(messages, displayName, language, instructions, allowedTools)
    messages.push(['system', template])

    const stream = await interactWithChatStream(messages, model, temperature, allowedTools)
    await storeBotAnswerStream(
        projectId,
        'topics',
        objectId,
        stream,
        userIdsToNotify,
        [FEED_PUBLIC_FOR_ALL],
        text => {
            let parsedText = replaceUserNameByMention(userName, userId, text)
            parsedText = addSpaceToUrl(linkToTasks, parsedText)
            return parsedText
        },
        assistant.uid,
        null,
        displayName,
        null, // requestUserId - not available in this flow
        null // userContext - not available in this flow
    )
}

module.exports = {
    generateBotWelcomeMessageForGuideUser,
}
