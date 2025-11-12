// Optimized version of assistantNormalTalk with parallel operations

const admin = require('firebase-admin')
const {
    getOptimizedContextMessages,
    interactWithChatStream, // Now uses cached clients internally
    storeBotAnswerStream,
    getAssistantForChat,
    reduceGoldWhenChatWithAI,
    COMPLETION_MAX_TOKENS,
    ENCODE_MESSAGE_GAP,
} = require('./assistantHelper')

const { getUserData } = require('../Users/usersFirestore')
const { Tiktoken } = require('@dqbd/tiktoken/lite')

const TOTAL_MAX_TOKENS_IN_MODEL = 4096
const ENCODE_INITIAL_GAP = 3

// Pre-load heavy JSON and encoder at module load time (cold start)
console.log('🚀 [TIMING] Pre-loading tiktoken JSON at module load...')
const jsonLoadStart = Date.now()
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')
console.log(`✅ [TIMING] Tiktoken JSON loaded: ${Date.now() - jsonLoadStart}ms`)

// Pre-initialize tiktoken encoder immediately after JSON load
const encoderInitStart = Date.now()
const encoder = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
console.log(`✅ [TIMING] Tiktoken encoder initialized: ${Date.now() - encoderInitStart}ms`)

function getEncoder() {
    return encoder // Always return pre-initialized encoder
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
    const functionStartTime = Date.now()
    console.log('🚀 [TIMING] askToOpenAIBotOptimized START', {
        timestamp: new Date().toISOString(),
        userId,
        messageId,
        projectId,
        objectType,
        objectId,
        assistantId,
    })

    try {
        // Step 1: Fetch user and assistant data in parallel
        const step1Start = Date.now()
        const [user, assistant] = await Promise.all([getUserData(userId), getAssistantForChat(projectId, assistantId)])
        const step1Duration = Date.now() - step1Start

        console.log('✅ [TIMING] Step 1 - PARALLEL User/Assistant fetch completed', {
            duration: `${step1Duration}ms`,
            hasAssistant: !!assistant,
            userGold: user?.gold,
            assistantModel: assistant?.model,
            elapsed: `${Date.now() - functionStartTime}ms`,
        })

        if (!user || user.gold <= 0) {
            console.log('⚠️ [TIMING] User has no gold', {
                userId,
                userGold: user?.gold,
                duration: `${Date.now() - functionStartTime}ms`,
            })
            return
        }

        const { model, temperature, instructions, displayName } = assistant

        // Extract user timezone
        const userTimezoneOffset =
            user.timezone ?? user.timezoneOffset ?? user.timezoneMinutes ?? user.preferredTimezone ?? null

        // Step 2: Parallel fetch context messages and common data
        const step2Start = Date.now()
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
        const step2Duration = Date.now() - step2Start

        console.log('✅ [TIMING] Step 2 - PARALLEL Context & Common Data fetch', {
            duration: `${step2Duration}ms`,
            messagesCount: messages?.length,
            hasCommonData: !!commonData,
            elapsed: `${Date.now() - functionStartTime}ms`,
        })

        // Step 3: Generate optimized context
        const step3Start = Date.now()
        const contextMessages = generateContextOptimized(messages)
        const step3Duration = Date.now() - step3Start

        console.log('✅ [TIMING] Step 3 - Context generation', {
            duration: `${step3Duration}ms`,
            contextMessagesCount: contextMessages?.length,
            elapsed: `${Date.now() - functionStartTime}ms`,
        })

        // Extract user context for tools
        const userContext = messages?.find(msg => msg[0] === 'user')
        const userContextForTools = userContext ? { message: userContext[1] || '' } : null

        // Step 4: Create stream (now uses cached clients internally)
        const step4Start = Date.now()
        const allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []
        const stream = await interactWithChatStream(contextMessages, model, temperature, allowedTools)
        const step4Duration = Date.now() - step4Start

        console.log('✅ [TIMING] Step 4 - Stream creation (optimized)', {
            duration: `${step4Duration}ms`,
            model,
            temperature,
            allowedToolsCount: allowedTools.length,
            elapsed: `${Date.now() - functionStartTime}ms`,
        })

        // Step 5: Process stream with pre-fetched data
        const step5Start = Date.now()
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
        const step5Duration = Date.now() - step5Start

        console.log('✅ [TIMING] Step 5 - Stream processing (with pre-fetched data)', {
            duration: `${step5Duration}ms`,
            hasComment: !!aiCommentText,
            commentLength: aiCommentText?.length,
            elapsed: `${Date.now() - functionStartTime}ms`,
        })

        // Step 6: Handle gold reduction
        let step6Duration = null
        if (aiCommentText) {
            const step6Start = Date.now()
            await reduceGoldWhenChatWithAI(userId, user.gold, model, aiCommentText, contextMessages)
            step6Duration = Date.now() - step6Start

            console.log('✅ [TIMING] Step 6 - Gold reduced', {
                duration: `${step6Duration}ms`,
                currentGold: user.gold,
                elapsed: `${Date.now() - functionStartTime}ms`,
            })
        }

        // Final summary
        const totalDuration = Date.now() - functionStartTime
        console.log('🎯 [TIMING] askToOpenAIBotOptimized COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                parallelUserAssistantFetch: `${step1Duration}ms`,
                parallelContextAndCommonData: `${step2Duration}ms`,
                contextGeneration: `${step3Duration}ms`,
                streamCreation: `${step4Duration}ms`,
                streamProcessing: `${step5Duration}ms`,
                goldReduction: step6Duration ? `${step6Duration}ms` : 'N/A',
            },
            optimization: 'PARALLEL_OPS',
        })
    } catch (error) {
        const errorDuration = Date.now() - functionStartTime
        console.error('❌ [TIMING] Error in askToOpenAIBotOptimized', {
            error: error.message,
            stack: error.stack,
            duration: `${errorDuration}ms`,
        })
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
        // Keep the pre-initialized encoder alive
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

    // For now, just use the regular storeBotAnswerStream
    // TODO: Create a version that accepts pre-fetched data
    const { storeBotAnswerStream } = require('./assistantHelper')
    return await storeBotAnswerStream(
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
