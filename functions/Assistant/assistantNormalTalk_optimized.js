// Optimized version of assistantNormalTalk with parallel operations

const admin = require('firebase-admin')
const {
    getOptimizedContextMessages,
    interactWithChatStreamOptimized,
    getCachedEnvFunctions,
} = require('./assistantHelper_optimized')

const {
    storeBotAnswerStream,
    getAssistantForChat,
    reduceGoldWhenChatWithAI,
    COMPLETION_MAX_TOKENS,
    ENCODE_MESSAGE_GAP,
} = require('./assistantHelper')

const { getUserData } = require('../Users/usersFirestore')
const { Tiktoken } = require('@dqbd/tiktoken/lite')
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')

const TOTAL_MAX_TOKENS_IN_MODEL = 4096
const ENCODE_INITIAL_GAP = 3

// Pre-initialize tiktoken encoder
let encoder = null
function getEncoder() {
    if (!encoder) {
        encoder = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
    }
    return encoder
}

async function askToOpenAIBotOptimized(
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
    console.log('askToOpenAIBotOptimized starting...')
    const startTime = Date.now()

    try {
        // Critical: Fetch user and assistant data in parallel
        const [user, assistant] = await Promise.all([getUserData(userId), getAssistantForChat(assistantId)])

        console.log(`User/Assistant fetch took: ${Date.now() - startTime}ms`)

        if (!user || user.gold <= 0) {
            console.log('User has no gold:', { userId, userGold: user?.gold })
            return
        }

        const { model, temperature, instructions, displayName } = assistant

        // Extract user timezone
        const userTimezoneOffset =
            user.timezone ?? user.timezoneOffset ?? user.timezoneMinutes ?? user.preferredTimezone ?? null

        // Start parallel operations
        const contextStart = Date.now()
        const [messages, commonData] = await Promise.all([
            // Fetch context messages
            getOptimizedContextMessages(
                messageId,
                projectId,
                objectType,
                objectId,
                language,
                displayName,
                instructions,
                Array.isArray(assistant.allowedTools) ? assistant.allowedTools : [],
                userTimezoneOffset,
                userId
            ),
            // Pre-fetch common data needed for storeBotAnswerStream
            getCommonDataOptimized(projectId, objectType, objectId),
        ])

        console.log(`Context fetch took: ${Date.now() - contextStart}ms`)

        // Generate optimized context
        const contextMessages = generateContextOptimized(messages)

        // Extract user context for tools
        const userContext = messages?.find(msg => msg[0] === 'user')
        const userContextForTools = userContext ? { message: userContext[1] || '' } : null

        // Start streaming
        const streamStart = Date.now()
        const allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []
        const stream = await interactWithChatStreamOptimized(contextMessages, model, temperature, allowedTools)

        console.log(`Stream initialization took: ${Date.now() - streamStart}ms`)
        console.log(`Total time before streaming: ${Date.now() - startTime}ms`)

        // Process stream with pre-fetched data
        const aiCommentText = await storeBotAnswerStreamOptimized(
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
            contextMessages,
            model,
            temperature,
            allowedTools,
            commonData // Pass pre-fetched data
        )

        // Handle gold reduction
        if (aiCommentText) {
            await reduceGoldWhenChatWithAI(userId, user.gold, model, aiCommentText, contextMessages)
        }

        console.log(`Total execution time: ${Date.now() - startTime}ms`)
    } catch (error) {
        console.error('Error in askToOpenAIBotOptimized:', error)
        throw error
    }
}

// Optimized context generation with caching
function generateContextOptimized(messages) {
    const encoder = getEncoder()
    let unusedTokens = TOTAL_MAX_TOKENS_IN_MODEL - COMPLETION_MAX_TOKENS
    const contextMessages = []

    try {
        for (let i = messages.length - 1; i >= 0; i--) {
            const encodedMessage = encoder.encode(messages[i][1])
            const messageTokens = encodedMessage.length + ENCODE_MESSAGE_GAP

            if (unusedTokens - messageTokens >= ENCODE_INITIAL_GAP) {
                contextMessages.push(messages[i])
                unusedTokens -= messageTokens
            } else {
                break
            }
        }
    } finally {
        // Don't free encoder - keep it cached
    }

    return contextMessages.reverse()
}

// Pre-fetch common data needed for storeBotAnswerStream
async function getCommonDataOptimized(projectId, objectType, objectId) {
    const [project, chat] = await Promise.all([
        admin
            .firestore()
            .doc(`projects/${projectId}`)
            .get()
            .then(doc => ({ id: projectId, ...doc.data() })),
        admin
            .firestore()
            .doc(`chatObjects/${projectId}/chats/${objectId}`)
            .get()
            .then(doc => doc.data()),
    ])

    const chatLink =
        chat?.objectType === 'topics' ? `/feed/${objectId}` : getLinkedParentChatUrl(projectId, objectType, objectId)

    return { project, chat, chatLink }
}

// Optimized version that accepts pre-fetched data
async function storeBotAnswerStreamOptimized(
    projectId,
    objectType,
    objectId,
    stream,
    userIdsToNotify,
    isPublicFor,
    parser,
    assistantId,
    followerIds,
    assistantName,
    requestUserId,
    userContext,
    conversationHistory,
    modelKey,
    temperatureKey,
    allowedTools,
    commonData // Pre-fetched data
) {
    const { project, chat, chatLink } = commonData || (await getCommonDataOptimized(projectId, objectType, objectId))

    if (!chat) return ''

    // Use the existing storeChunks function with the pre-fetched data
    const { storeChunks } = require('./assistantHelper')
    return await storeChunks(
        projectId,
        objectType,
        objectId,
        userIdsToNotify,
        stream,
        parser,
        assistantId,
        isPublicFor,
        followerIds,
        chat.title,
        assistantName,
        project.name,
        chatLink,
        requestUserId || '',
        userContext,
        conversationHistory,
        modelKey,
        temperatureKey,
        allowedTools
    )
}

// Helper function
function getLinkedParentChatUrl(projectId, objectType, objectId) {
    const objectTypeToUrl = {
        tasks: `/task/${objectId}`,
        notes: `/note/${objectId}`,
        goals: `/goal/${objectId}`,
        contacts: `/contact/${objectId}`,
        chats: `/chat/${objectId}`,
    }
    return objectTypeToUrl[objectType] || ''
}

module.exports = {
    askToOpenAIBot: askToOpenAIBotOptimized,
}
