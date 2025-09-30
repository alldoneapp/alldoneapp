const admin = require('firebase-admin')
const { Tiktoken } = require('@dqbd/tiktoken/lite')
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')

const {
    COMPLETION_MAX_TOKENS,
    interactWithChatStream,
    storeBotAnswerStream,
    getAssistantForChat,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
    ENCODE_MESSAGE_GAP,
    reduceGoldWhenChatWithAI,
} = require('./assistantHelper')
const { getUserData } = require('../Users/usersFirestore')

const TOTAL_MAX_TOKENS_IN_MODEL = 4096
const ENCODE_INITIAL_GAP = 3

async function getMessageDocs(projectId, objectType, objectId) {
    const commentDocs = (
        await admin
            .firestore()
            .collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`)
            .orderBy('lastChangeDate', 'desc')
            .limit(50)
            .get()
    ).docs
    return commentDocs
}

function addMessageToList(messages, messageData) {
    const { commentText, fromAssistant } = messageData

    if (fromAssistant) {
        messages.push(['ai', parseTextForUseLiKePrompt(commentText)])
    } else {
        messages.push(['user', parseTextForUseLiKePrompt(commentText)])
    }
}

function filterMessages(messageId, commentDocs, language, assistantName, instructions, allowedTools = []) {
    const messages = []

    let amountOfCommentsInContext = 0
    for (let i = 0; i < commentDocs.length; i++) {
        if (amountOfCommentsInContext > 0 || messageId === commentDocs[i].id) {
            addMessageToList(messages, commentDocs[i].data())
            amountOfCommentsInContext++
            if (amountOfCommentsInContext === 3) break
        }
    }

    addBaseInstructions(messages, assistantName, language, instructions, allowedTools)
    return messages.reverse()
}

async function getContextMessages(
    messageId,
    projectId,
    objectType,
    objectId,
    language,
    assistantName,
    instructions,
    allowedTools = []
) {
    const commentDocs = await getMessageDocs(projectId, objectType, objectId)
    return filterMessages(messageId, commentDocs, language, assistantName, instructions, allowedTools)
}

function generateContext(messages) {
    let unusedTokens = TOTAL_MAX_TOKENS_IN_MODEL - COMPLETION_MAX_TOKENS - ENCODE_INITIAL_GAP

    const encoding = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)

    const contextMessages = []
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        const tokens = encoding.encode(message[1]).length + ENCODE_MESSAGE_GAP
        unusedTokens -= tokens
        if (unusedTokens >= 0) contextMessages.push(message)
    }
    encoding.free()
    return contextMessages.reverse()
}

async function askToOpenAIBot(
    userId,
    messageId,
    projectId,
    objectType,
    objectId,
    userIdsToNotify,
    isPublicFor,
    language,
    assistantId,
    followerIds
) {
    console.log('Starting askToOpenAIBot with params:', {
        userId,
        messageId,
        projectId,
        objectType,
        objectId,
        userIdsToNotify,
        isPublicFor,
        language,
        assistantId,
        followerIds,
    })

    const promises = []
    promises.push(getAssistantForChat(projectId, assistantId))
    promises.push(getUserData(userId))
    const [assistant, user] = await Promise.all(promises)

    console.log('Retrieved assistant and user data:', {
        hasAssistant: !!assistant,
        userGold: user?.gold,
        assistantModel: assistant?.model,
    })

    if (user.gold > 0) {
        const { model, temperature, instructions, displayName } = assistant

        const messages = await getContextMessages(
            messageId,
            projectId,
            objectType,
            objectId,
            language,
            displayName,
            instructions,
            Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []
        )

        console.log('Generated context messages:', {
            messagesCount: messages?.length,
        })

        const contextMessages = generateContext(messages)

        console.log('Generated context messages:', {
            contextMessagesCount: contextMessages?.length,
        })

        // Extract the latest user message for tool context
        const userContext = messages && messages.length > 0 ? messages.find(msg => msg[0] === 'user') : null
        const userContextForTools = userContext ? { message: userContext[1] || '' } : null

        console.log('Extracted user context for tools:', {
            hasUserContext: !!userContextForTools,
            messageLength: userContextForTools?.message?.length || 0,
        })

        try {
            const allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []
            const stream = await interactWithChatStream(contextMessages, model, temperature, allowedTools)

            console.log('Got stream from interactWithChatStream')

            const aiCommentText = await storeBotAnswerStream(
                projectId,
                objectType,
                objectId,
                stream,
                userIdsToNotify,
                isPublicFor,
                null,
                assistant.uid,
                followerIds,
                displayName,
                userId,
                userContextForTools,
                contextMessages, // conversationHistory
                model, // modelKey
                temperature, // temperatureKey
                allowedTools
            )

            console.log('Generated AI comment:', {
                hasComment: !!aiCommentText,
                commentLength: aiCommentText?.length,
            })

            if (aiCommentText) {
                console.log('Reducing gold for user:', {
                    userId,
                    currentGold: user.gold,
                    model,
                    contextMessagesCount: contextMessages.length,
                })
                await reduceGoldWhenChatWithAI(userId, user.gold, model, aiCommentText, contextMessages)
            }
        } catch (error) {
            console.error('Error in askToOpenAIBot:', error)
            throw error
        }
    } else {
        console.log('User has no gold:', {
            userId,
            userGold: user?.gold,
        })
    }
}

module.exports = {
    askToOpenAIBot,
}
