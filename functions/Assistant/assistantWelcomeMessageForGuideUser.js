const {
    replaceUserNameByMention,
    addSpaceToUrl,
    interactWithChatStream,
    storeBotAnswerStream,
    getAssistantForChat,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
    getCommonData, // For parallel fetching to reduce time-to-first-token
} = require('./assistantHelper')
const { FEED_PUBLIC_FOR_ALL } = require('../Utils/HelperFunctionsCloud')
const { getUserData } = require('../Users/usersFirestore')

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
    const promises = []
    promises.push(getAssistantForChat(projectId, assistantId))
    promises.push(getUserData(userId))
    const [assistant, user] = await Promise.all(promises)

    const { model, temperature, instructions, displayName, allowedTools } = assistant

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

    const linkToTasks = `${taskListUrlOrigin}/projects/${projectId}/user/${userId}/tasks/open`
    const template = parseTextForUseLiKePrompt(
        `Imagine your job is to welcome new users to a community which helps them to do the following: "${guideName}". The name of the user is ${userName}. Tell the user that the user can look at the step-by-step tasks in this community by clicking on this link ${linkToTasks} or on Tasks in the sidebar. If the user is on mobile the user needs to click at the top left to open the menu. To achieve his or her goal the user should just do the tasks from top to bottom as written in the task overview. Try to be helpful and encourage the user to ask if he or she has any questions. Directly ask the user what's currently on his or her mind which blocks him or her reaching his or her goal? Where in the process is he or she currently? Be short and precise.`
    )

    const messages = []
    addBaseInstructions(messages, displayName, language, instructions, allowedTools, userTimezoneOffset)
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
        text => {
            let parsedText = replaceUserNameByMention(userName, userId, text)
            parsedText = addSpaceToUrl(linkToTasks, parsedText)
            return parsedText
        },
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
    generateBotWelcomeMessageForGuideUser,
}
