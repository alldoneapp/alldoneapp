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
const { fetchMentionedNotesContext } = require('./noteContextHelper')

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
        messages.push(['assistant', parseTextForUseLiKePrompt(commentText)])
    } else {
        messages.push(['user', parseTextForUseLiKePrompt(commentText)])
    }
}

function filterMessages(
    messageId,
    commentDocs,
    language,
    assistantName,
    instructions,
    allowedTools = [],
    userTimezoneOffset = null
) {
    const messages = []

    let amountOfCommentsInContext = 0
    for (let i = 0; i < commentDocs.length; i++) {
        if (amountOfCommentsInContext > 0 || messageId === commentDocs[i].id) {
            addMessageToList(messages, commentDocs[i].data())
            amountOfCommentsInContext++
            if (amountOfCommentsInContext === 3) break
        }
    }

    addBaseInstructions(messages, assistantName, language, instructions, allowedTools, userTimezoneOffset)
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
    allowedTools = [],
    userTimezoneOffset = null,
    userId = null
) {
    const startTime = Date.now()
    console.log('🔍 [TIMING] getContextMessages START')

    // Fetch messages from Firestore
    const fetchStart = Date.now()
    const commentDocs = await getMessageDocs(projectId, objectType, objectId)
    console.log(`📊 [TIMING] getMessageDocs: ${Date.now() - fetchStart}ms (fetched ${commentDocs.length} docs)`)

    // Filter and process messages
    const filterStart = Date.now()
    const messages = filterMessages(
        messageId,
        commentDocs,
        language,
        assistantName,
        instructions,
        allowedTools,
        userTimezoneOffset
    )
    console.log(`📊 [TIMING] filterMessages: ${Date.now() - filterStart}ms (processed ${messages.length} messages)`)

    // Extract and add mentioned notes context if userId is provided
    if (userId && messageId) {
        const notesStart = Date.now()
        try {
            // Find the current message (the one that triggered the assistant)
            const currentMessageDoc = commentDocs.find(doc => doc.id === messageId)

            if (currentMessageDoc) {
                const currentMessage = currentMessageDoc.data()
                const commentText = currentMessage.commentText

                // Fetch mentioned notes context
                const notesContext = await fetchMentionedNotesContext(commentText, userId, projectId)

                if (notesContext) {
                    console.log(`📊 [TIMING] fetchMentionedNotesContext: ${Date.now() - notesStart}ms`)
                    // Append notes to the last user message (which is the current user message)
                    const lastMessageIndex = messages.length - 1
                    if (lastMessageIndex >= 0 && messages[lastMessageIndex][0] === 'user') {
                        messages[lastMessageIndex][1] += notesContext
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching mentioned notes context:', error)
            // Continue without note context if there's an error
        }
    }

    console.log(`🔍 [TIMING] getContextMessages COMPLETE: ${Date.now() - startTime}ms`)
    return messages
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
    const functionStartTime = Date.now()
    console.log('🚀 [TIMING] askToOpenAIBot START', {
        timestamp: new Date().toISOString(),
        userId,
        messageId,
        projectId,
        objectType,
        objectId,
        assistantId,
    })

    // Step 1: Fetch user and assistant data
    const step1Start = Date.now()
    const promises = []
    promises.push(getAssistantForChat(projectId, assistantId))
    promises.push(getUserData(userId))
    const [assistant, user] = await Promise.all(promises)
    const step1Duration = Date.now() - step1Start

    console.log('✅ [TIMING] Step 1 - User/Assistant fetch completed', {
        duration: `${step1Duration}ms`,
        hasAssistant: !!assistant,
        userGold: user?.gold,
        assistantModel: assistant?.model,
        elapsed: `${Date.now() - functionStartTime}ms`,
    })

    if (user.gold > 0) {
        const { model, temperature, instructions, displayName } = assistant

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

        // Step 2: Fetch context messages
        const step2Start = Date.now()
        const messages = await getContextMessages(
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
        )
        const step2Duration = Date.now() - step2Start

        console.log('✅ [TIMING] Step 2 - Context messages fetched', {
            duration: `${step2Duration}ms`,
            messagesCount: messages?.length,
            elapsed: `${Date.now() - functionStartTime}ms`,
        })

        // Step 3: Generate context (token counting)
        const step3Start = Date.now()
        const contextMessages = generateContext(messages)
        const step3Duration = Date.now() - step3Start

        console.log('✅ [TIMING] Step 3 - Context generated', {
            duration: `${step3Duration}ms`,
            contextMessagesCount: contextMessages?.length,
            elapsed: `${Date.now() - functionStartTime}ms`,
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

            // Step 4: Create OpenAI stream
            const step4Start = Date.now()
            const stream = await interactWithChatStream(contextMessages, model, temperature, allowedTools)
            const step4Duration = Date.now() - step4Start

            console.log('✅ [TIMING] Step 4 - OpenAI stream created', {
                duration: `${step4Duration}ms`,
                model,
                temperature,
                allowedToolsCount: allowedTools.length,
                elapsed: `${Date.now() - functionStartTime}ms`,
            })

            // Step 5: Process stream and store answer
            const step5Start = Date.now()
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
            const step5Duration = Date.now() - step5Start

            console.log('✅ [TIMING] Step 5 - Stream processed and stored', {
                duration: `${step5Duration}ms`,
                hasComment: !!aiCommentText,
                commentLength: aiCommentText?.length,
                elapsed: `${Date.now() - functionStartTime}ms`,
            })

            if (aiCommentText) {
                // Step 6: Reduce gold
                const step6Start = Date.now()
                await reduceGoldWhenChatWithAI(userId, user.gold, model, aiCommentText, contextMessages)
                const step6Duration = Date.now() - step6Start

                console.log('✅ [TIMING] Step 6 - Gold reduced', {
                    duration: `${step6Duration}ms`,
                    currentGold: user.gold,
                    elapsed: `${Date.now() - functionStartTime}ms`,
                })
            }
            // Final summary
            const totalDuration = Date.now() - functionStartTime
            console.log('🎯 [TIMING] askToOpenAIBot COMPLETE', {
                totalDuration: `${totalDuration}ms`,
                breakdown: {
                    userAssistantFetch: `${step1Duration}ms`,
                    contextFetch: `${step2Duration}ms`,
                    contextGeneration: `${step3Duration}ms`,
                    streamCreation: `${step4Duration}ms`,
                    streamProcessing: `${step5Duration}ms`,
                    goldReduction: aiCommentText ? `${step6Duration}ms` : 'N/A',
                },
            })
        } catch (error) {
            const errorDuration = Date.now() - functionStartTime
            console.error('❌ [TIMING] Error in askToOpenAIBot', {
                error: error.message,
                stack: error.stack,
                duration: `${errorDuration}ms`,
            })
            throw error
        }
    } else {
        console.log('⚠️ [TIMING] User has no gold', {
            userId,
            userGold: user?.gold,
            duration: `${Date.now() - functionStartTime}ms`,
        })
    }
}

module.exports = {
    askToOpenAIBot,
}
