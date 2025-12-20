const { v4: uuidv4 } = require('uuid')
const admin = require('firebase-admin')
const moment = require('moment')
const OpenAI = require('openai')
const { Tiktoken } = require('@dqbd/tiktoken/lite')
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')

const {
    MENTION_SPACE_CODE,
    STAYWARD_COMMENT,
    FEED_PUBLIC_FOR_ALL,
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY,
    inProductionEnvironment,
    OPEN_STEP,
} = require('../Utils/HelperFunctionsCloud')
const { logEvent } = require('../GAnalytics/GAnalytics')
const {
    GLOBAL_PROJECT_ID,
    getDefaultAssistantData,
    updateAssistantLastCommentData,
} = require('../Firestore/assistantsFirestore')
const { updateContactLastCommentData } = require('../Firestore/contactsFirestore')
const { updateUserLastCommentData } = require('../Users/usersFirestore')
const { updateSkillLastCommentData } = require('../Skills/skillsFirestore')
const { updateTaskLastCommentData } = require('../Tasks/tasksFirestoreCloud')
const { updateGoalLastCommentData } = require('../Goals/goalsFirestore')
const { updateNoteLastCommentData } = require('../Notes/notesFirestoreCloud')
const {
    removeFormatTagsFromText,
    cleanTextMetaData,
    shrinkTagText,
    LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN,
} = require('../Utils/parseTextUtils')
const { getObjectFollowersIds } = require('../Feeds/globalFeedsHelper')
const { getProject } = require('../Firestore/generalFirestoreCloud')
const { getChat } = require('../Chats/chatsFirestoreCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { ENABLE_DETAILED_LOGGING } = require('./performanceConfig')

const MODEL_GPT3_5 = 'MODEL_GPT3_5'
const MODEL_GPT4 = 'MODEL_GPT4'
const MODEL_GPT4O = 'MODEL_GPT4O'
const MODEL_GPT5 = 'MODEL_GPT5' // Deprecated, maps to MODEL_GPT5_1
const MODEL_GPT5_1 = 'MODEL_GPT5_1'
const MODEL_SONAR = 'MODEL_SONAR'
const MODEL_SONAR_PRO = 'MODEL_SONAR_PRO'
const MODEL_SONAR_REASONING = 'MODEL_SONAR_REASONING'
const MODEL_SONAR_REASONING_PRO = 'MODEL_SONAR_REASONING_PRO'
const MODEL_SONAR_DEEP_RESEARCH = 'MODEL_SONAR_DEEP_RESEARCH'

const TEMPERATURE_VERY_LOW = 'TEMPERATURE_VERY_LOW'
const TEMPERATURE_LOW = 'TEMPERATURE_LOW'
const TEMPERATURE_NORMAL = 'TEMPERATURE_NORMAL'
const TEMPERATURE_HIGH = 'TEMPERATURE_HIGH'
const TEMPERATURE_VERY_HIGH = 'TEMPERATURE_VERY_HIGH'

const COMPLETION_MAX_TOKENS = 1000
const COMPLETION_MAX_TOKENS_GPT5_1 = 2000 // GPT-5.1 needs more tokens due to stricter limits

const ENCODE_MESSAGE_GAP = 4
const CHARACTERS_PER_TOKEN_SONAR = 4 // Approximate number of characters per token for Sonar models

// Service instance caches for reuse across tool executions (performance optimization)
// Similar pattern to MCP server for consistency
let cachedNoteService = null
let cachedSearchService = null
let cachedTaskService = null

// Cache environment variables at module level (performance optimization)
let cachedEnvFunctions = null
let envLoadTime = 0

function getCachedEnvFunctions() {
    const now = Date.now()
    // Cache for 5 minutes
    if (!cachedEnvFunctions || now - envLoadTime > 300000) {
        cachedEnvFunctions = getEnvFunctions()
        envLoadTime = now
    }
    return cachedEnvFunctions
}

// Cache OpenAI clients (performance optimization)
const openAIClients = new Map()

function getOpenAIClient(apiKey) {
    if (!openAIClients.has(apiKey)) {
        openAIClients.set(apiKey, new OpenAI({ apiKey }))
    }
    return openAIClients.get(apiKey)
}

/**
 * Check if a model supports native OpenAI tool/function calling
 * @param {string} modelKey - The model key (e.g., MODEL_GPT4O)
 * @returns {boolean} True if model supports native tool calling
 */
const modelSupportsNativeTools = modelKey => {
    // Only GPT models support native tool calling
    return modelKey === MODEL_GPT3_5 || modelKey === MODEL_GPT4 || modelKey === MODEL_GPT4O || modelKey === MODEL_GPT5_1
}

/**
 * Check if a model supports custom temperature values
 * @param {string} modelKey - The model key (e.g., MODEL_GPT4O)
 * @returns {boolean} True if model supports custom temperature
 */
const modelSupportsCustomTemperature = modelKey => {
    // GPT-5.1 and some newer models only support default temperature (1.0)
    if (modelKey === MODEL_GPT5_1) return false
    return true
}

const getTokensPerGold = modelKey => {
    if (modelKey === MODEL_GPT3_5) return 100
    if (modelKey === MODEL_GPT4) return 10
    if (modelKey === MODEL_GPT4O) return 50
    if (modelKey === MODEL_GPT5_1) return 10
    if (modelKey === MODEL_SONAR) return 100
    if (modelKey === MODEL_SONAR_PRO) return 50
    if (modelKey === MODEL_SONAR_REASONING) return 20
    if (modelKey === MODEL_SONAR_REASONING_PRO) return 15
    if (modelKey === MODEL_SONAR_DEEP_RESEARCH) return 10
}

const getMaxTokensForModel = modelKey => {
    // Legacy/Low context models
    if (modelKey === MODEL_GPT3_5) return 16000
    if (modelKey === MODEL_GPT4) return 8000

    // Modern High context models
    if (modelKey === MODEL_GPT4O) return 128000
    if (modelKey === MODEL_GPT5_1) return 128000

    // Perplexity/Sonar models (generally high context)
    if (modelKey && modelKey.startsWith('MODEL_SONAR')) return 128000

    // Default fallback
    return 128000
}

// Normalize model key for backward compatibility
const normalizeModelKey = modelKey => {
    // Map deprecated MODEL_GPT5 to MODEL_GPT5_1
    if (modelKey === MODEL_GPT5 || modelKey === 'MODEL_GPT5') return MODEL_GPT5_1
    // Default to MODEL_GPT5_1 if no model specified or empty
    if (!modelKey) return MODEL_GPT5_1
    return modelKey
}

const getModel = modelKey => {
    // Normalize the model key first
    const normalizedKey = normalizeModelKey(modelKey)

    if (normalizedKey === MODEL_GPT3_5) return 'gpt-3.5-turbo'
    if (normalizedKey === MODEL_GPT4) return 'gpt-4'
    if (normalizedKey === MODEL_GPT4O) return 'gpt-4o'
    if (normalizedKey === MODEL_GPT5_1) return 'gpt-5.1'
    if (normalizedKey === MODEL_SONAR) return 'sonar'
    if (normalizedKey === MODEL_SONAR_PRO) return 'sonar-pro'
    if (normalizedKey === MODEL_SONAR_REASONING) return 'sonar-reasoning'
    if (normalizedKey === MODEL_SONAR_REASONING_PRO) return 'sonar-reasoning-pro'
    if (normalizedKey === MODEL_SONAR_DEEP_RESEARCH) return 'sonar-deep-research'

    // Default fallback to gpt-5.1
    return 'gpt-5.1'
}

const getTemperature = temperatureKey => {
    if (temperatureKey === TEMPERATURE_VERY_LOW) return 0.2
    else if (temperatureKey === TEMPERATURE_LOW) return 0.5
    else if (temperatureKey === TEMPERATURE_NORMAL) return 0.7
    else if (temperatureKey === TEMPERATURE_HIGH) return 1
    return 1.3
}

async function spentGold(userId, goldToReduce) {
    console.log('🔋 GOLD COST TRACKING: Spending gold:', { userId, goldToReduce })

    // Check if FieldValue.increment is available
    if (admin.firestore.FieldValue && admin.firestore.FieldValue.increment) {
        console.log('🔋 GOLD COST TRACKING: Using FieldValue.increment')
        const promises = []
        promises.push(
            admin
                .firestore()
                .doc(`users/${userId}`)
                .update({
                    gold: admin.firestore.FieldValue.increment(-goldToReduce),
                })
        )
        promises.push(logEvent(userId, 'SpentGold', { spentGold: goldToReduce }))
        await Promise.all(promises)
    } else {
        console.log('🔋 GOLD COST TRACKING: FieldValue.increment not available, using manual calculation')
        // Fallback for emulator: get current gold, then update manually
        const userDoc = await admin.firestore().doc(`users/${userId}`).get()
        const currentGold = userDoc.data()?.gold || 0
        const newGold = Math.max(0, currentGold - goldToReduce)

        console.log('🔋 GOLD COST TRACKING: Manual calculation:', { currentGold, goldToReduce, newGold })

        const promises = []
        promises.push(admin.firestore().doc(`users/${userId}`).update({ gold: newGold }))
        promises.push(logEvent(userId, 'SpentGold', { spentGold: goldToReduce }))
        await Promise.all(promises)
    }
}

const reduceGoldWhenChatWithAI = async (
    userId,
    userCurrentGold,
    aiModel,
    aiCommentText,
    contextMessages,
    encoder = null
) => {
    console.log('🔋 GOLD COST TRACKING: Starting gold reduction process:', {
        userId,
        userCurrentGold,
        aiModel,
        modelName: getModel(aiModel),
        tokensPerGold: getTokensPerGold(aiModel),
        textLength: aiCommentText?.length,
        contextMessagesCount: contextMessages?.length,
        hasReusedEncoder: !!encoder,
    })

    const tokens = calculateTokens(aiCommentText, contextMessages, aiModel, encoder)
    console.log('🔋 GOLD COST TRACKING: Token calculation complete:', {
        totalTokens: tokens,
        aiModel,
        tokensPerGold: getTokensPerGold(aiModel),
    })

    const goldToReduce = calculateGoldToReduce(userCurrentGold, tokens, aiModel)
    console.log('🔋 GOLD COST TRACKING: Gold calculation complete:', {
        goldToReduce,
        userCurrentGold,
        costPerToken: 1 / getTokensPerGold(aiModel),
        totalCost: tokens / getTokensPerGold(aiModel),
        cappedAtUserGold: goldToReduce < tokens / getTokensPerGold(aiModel),
    })

    await spentGold(userId, goldToReduce)
    console.log('🔋 GOLD COST TRACKING: Gold reduction completed')
}

const calculateTokens = (aiText, contextMessages, modelKey, encoder = null) => {
    console.log('🧮 TOKEN CALCULATION: Starting for model:', modelKey)

    const aiTextLength = aiText?.length || 0
    const contextMessageDetails = contextMessages.map((msg, index) => ({
        index,
        type: msg[0],
        length: msg[1]?.length || 0,
    }))

    console.log('🧮 TOKEN CALCULATION: Input details:', {
        modelKey,
        aiTextLength,
        contextMessagesCount: contextMessages.length,
        contextMessageDetails,
        encodeMessageGap: ENCODE_MESSAGE_GAP,
        hasReusedEncoder: !!encoder,
    })

    // For Sonar models, use character count
    if (modelKey && modelKey.startsWith('MODEL_SONAR')) {
        let totalChars = aiTextLength
        let contextChars = 0
        contextMessages.forEach(msg => {
            const msgLength = msg[1]?.length || 0
            contextChars += msgLength
            totalChars += msgLength
        })
        const baseTokens = Math.ceil(totalChars / CHARACTERS_PER_TOKEN_SONAR)
        const gapTokens = (contextMessages.length + 1) * ENCODE_MESSAGE_GAP
        const tokens = baseTokens + gapTokens

        console.log('🧮 TOKEN CALCULATION: Sonar model result:', {
            totalChars,
            aiTextChars: aiTextLength,
            contextChars,
            charactersPerToken: CHARACTERS_PER_TOKEN_SONAR,
            baseTokens,
            gapTokens,
            totalTokens: tokens,
        })
        return tokens
    }

    // For other models, use token encoding
    // Reuse provided encoder or create a new one
    const encoding = encoder || new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
    let aiTokens = encoding.encode(aiText).length
    let contextTokens = 0
    let gapTokens = ENCODE_MESSAGE_GAP // Gap for AI response

    contextMessages.forEach((msg, index) => {
        const msgTokens = encoding.encode(msg[1]).length
        contextTokens += msgTokens
        gapTokens += ENCODE_MESSAGE_GAP
        console.log(`🧮 TOKEN CALCULATION: Context message ${index} (${msg[0]}): ${msgTokens} tokens`)
    })

    const totalTokens = aiTokens + contextTokens + gapTokens

    // Only free encoder if we created it (not if it was passed in)
    if (!encoder) {
        encoding.free()
    }

    console.log('🧮 TOKEN CALCULATION: OpenAI model result:', {
        aiTokens,
        contextTokens,
        gapTokens,
        totalTokens,
        breakdown: {
            aiResponse: aiTokens,
            contextMessages: contextTokens,
            encodingGaps: gapTokens,
        },
    })
    return totalTokens
}

const calculateGoldToReduce = (userGold, totalTokens, model) => {
    console.log('Calculating gold Reduction:', {
        userGold,
        totalTokens,
        model,
        tokensPerGold: getTokensPerGold(model),
    })
    const goldCost = Math.round(totalTokens / getTokensPerGold(model))
    const goldToReduce = userGold - goldCost > 0 ? goldCost : userGold
    return goldToReduce
}

async function interactWithChatStream(formattedPrompt, modelKey, temperatureKey, allowedTools = []) {
    const streamStartTime = Date.now()
    console.log('🌊 [TIMING] interactWithChatStream START', {
        timestamp: new Date().toISOString(),
        modelKey,
        allowedToolsCount: allowedTools.length,
        promptLength: formattedPrompt?.length,
    })

    // Step 1: Get model config and cached environment
    const configStart = Date.now()
    const model = getModel(modelKey) || 'gpt-5.1' // Fallback to gpt-5.1 if undefined
    const temperature = getTemperature(temperatureKey)
    const envFunctions = getCachedEnvFunctions() // Use cached version
    const configDuration = Date.now() - configStart

    console.log(`📊 [TIMING] Config loading: ${configDuration}ms`, {
        model,
        temperature,
        hasPerplexityKey: !!envFunctions.PERPLEXITY_API_KEY,
        hasOpenAIKey: !!envFunctions.OPEN_AI_KEY,
    })

    const { OPEN_AI_KEY, PERPLEXITY_API_KEY } = envFunctions

    // Check if it's a Perplexity model
    if (modelKey.startsWith('MODEL_SONAR')) {
        console.log('Using Perplexity model')
        const { PerplexityClient } = require('./perplexityClient')
        try {
            console.log('Creating PerplexityClient instance...')
            // Convert messages to Perplexity format [role, content]
            const formattedMessages = Array.isArray(formattedPrompt)
                ? formattedPrompt.map(msg => {
                      // Handle array format [role, content]
                      if (Array.isArray(msg)) {
                          return msg
                      }
                      // Handle object format { role, content }
                      if (typeof msg === 'object' && msg.role && msg.content) {
                          return [msg.role, msg.content]
                      }
                      console.error('Unexpected message format:', JSON.stringify(msg))
                      throw new Error('Unexpected message format')
                  })
                : formattedPrompt
            console.log('Formatted messages:', JSON.stringify(formattedMessages, null, 2))

            const client = new PerplexityClient(PERPLEXITY_API_KEY, model)
            console.log('PerplexityClient created successfully')
            return await client.stream(formattedMessages)
        } catch (error) {
            console.error('Error creating PerplexityClient:', error)
            throw error
        }
    } else {
        // Native OpenAI implementation with tool calling support
        // Use cached OpenAI client (performance optimization)
        const openAIInitStart = Date.now()
        const openai = getOpenAIClient(OPEN_AI_KEY)
        console.log(`📊 [TIMING] OpenAI client (CACHED): ${Date.now() - openAIInitStart}ms`)

        // Convert messages to OpenAI format
        const formatStart = Date.now()
        const messages = Array.isArray(formattedPrompt)
            ? formattedPrompt.map(msg => {
                  // Handle array format [role, content]
                  if (Array.isArray(msg)) {
                      return { role: msg[0], content: msg[1] }
                  }
                  // Handle object format { role, content, tool_calls?, tool_call_id? }
                  if (typeof msg === 'object' && msg.role) {
                      const result = { role: msg.role, content: msg.content || '' }
                      // Preserve tool_calls for assistant messages
                      if (msg.tool_calls) {
                          result.tool_calls = msg.tool_calls
                      }
                      // Preserve tool_call_id for tool messages
                      if (msg.tool_call_id) {
                          result.tool_call_id = msg.tool_call_id
                      }
                      return result
                  }
                  console.error('Unexpected message format:', JSON.stringify(msg))
                  throw new Error('Unexpected message format')
              })
            : formattedPrompt
        console.log(`📊 [TIMING] Message formatting: ${Date.now() - formatStart}ms`)

        const requestParams = {
            model: model,
            messages: messages,
            stream: true,
        }

        // Let OpenAI manage token limits naturally - don't set max_completion_tokens
        console.log(`Using natural token limits for model ${model}`)

        // Only add temperature if the model supports custom temperature
        // Some models (like gpt-5.1) only support the default temperature (1.0)
        if (modelSupportsCustomTemperature(modelKey)) {
            requestParams.temperature = temperature
        } else {
            console.log(`Model ${model} does not support custom temperature, using default (1.0)`)
        }

        // Add tools if model supports native tools and tools are allowed
        if (modelSupportsNativeTools(modelKey) && Array.isArray(allowedTools) && allowedTools.length > 0) {
            const { getToolSchemas } = require('./toolSchemas')
            const toolSchemas = getToolSchemas(allowedTools)
            if (toolSchemas.length > 0) {
                console.log(
                    'Using native tool schemas:',
                    toolSchemas.map(t => t.function.name)
                )
                requestParams.tools = toolSchemas
            }
        }

        console.log('Creating OpenAI stream with params:', {
            model: requestParams.model,
            temperature: requestParams.temperature,
            max_tokens: requestParams.max_tokens,
            messageCount: messages.length,
            hasTools: !!requestParams.tools,
            toolCount: requestParams.tools?.length,
            toolNames: requestParams.tools?.map(t => t.function.name),
            messagesPreview: messages.map((m, idx) => ({
                index: idx,
                role: m.role,
                contentLength: m.content?.length,
                contentPreview: m.content?.substring(0, 200),
                hasToolCalls: !!m.tool_calls,
                toolCallsCount: m.tool_calls?.length,
                hasToolCallId: !!m.tool_call_id,
                toolCallId: m.tool_call_id,
            })),
            lastMessage: messages[messages.length - 1]
                ? {
                      role: messages[messages.length - 1].role,
                      content: messages[messages.length - 1].content?.substring(0, 300),
                      hasToolCalls: !!messages[messages.length - 1].tool_calls,
                      hasToolCallId: !!messages[messages.length - 1].tool_call_id,
                  }
                : null,
        })

        // Make the actual API call to OpenAI
        const apiCallStart = Date.now()
        console.log('📞 [TIMING] Calling OpenAI API...')
        const stream = await openai.chat.completions.create(requestParams)
        const apiCallDuration = Date.now() - apiCallStart
        console.log(`✅ [TIMING] OpenAI API call successful: ${apiCallDuration}ms`)

        const totalDuration = Date.now() - streamStartTime
        console.log('🌊 [TIMING] interactWithChatStream COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                configLoading: `${configDuration}ms`,
                openAIClientInit: openAIInitStart ? `${Date.now() - openAIInitStart - apiCallDuration}ms` : 'N/A',
                apiCall: `${apiCallDuration}ms`,
                model,
                temperature,
            },
        })

        // Convert OpenAI stream to our expected format
        return convertOpenAIStream(stream)
    }
}

/**
 * Convert OpenAI stream chunks to our expected format
 * Accumulates tool calls across multiple chunks since OpenAI streams them incrementally
 */
async function* convertOpenAIStream(stream) {
    let accumulatedToolCalls = {}
    let chunkCount = 0
    let totalContentLength = 0

    if (ENABLE_DETAILED_LOGGING) {
        console.log('🔧 STREAM CONVERTER: Starting to process OpenAI stream')
    }

    for await (const chunk of stream) {
        chunkCount++
        const delta = chunk.choices[0]?.delta
        const finishReason = chunk.choices[0]?.finish_reason

        const logData = {
            chunkNumber: chunkCount,
            hasDelta: !!delta,
            hasContent: !!delta?.content,
            contentLength: delta?.content?.length || 0,
            content: delta?.content || '',
            hasToolCalls: !!delta?.tool_calls,
            toolCallsCount: delta?.tool_calls?.length || 0,
            finishReason: finishReason,
            hasRole: !!delta?.role,
            role: delta?.role,
        }

        if (delta?.content) {
            totalContentLength += delta.content.length
        }

        if (ENABLE_DETAILED_LOGGING) {
            console.log(`🔧 STREAM CONVERTER: Chunk #${chunkCount}:`, logData)
        }

        if (!delta && !finishReason) continue

        // Handle tool calls - OpenAI streams them in chunks
        if (delta?.tool_calls) {
            for (const toolCallChunk of delta.tool_calls) {
                const index = toolCallChunk.index

                if (!accumulatedToolCalls[index]) {
                    accumulatedToolCalls[index] = {
                        id: toolCallChunk.id || '',
                        type: toolCallChunk.type || 'function',
                        function: {
                            name: toolCallChunk.function?.name || '',
                            arguments: toolCallChunk.function?.arguments || '',
                        },
                    }
                } else {
                    // Accumulate arguments
                    if (toolCallChunk.function?.arguments) {
                        accumulatedToolCalls[index].function.arguments += toolCallChunk.function.arguments
                    }
                    if (toolCallChunk.function?.name) {
                        accumulatedToolCalls[index].function.name += toolCallChunk.function.name
                    }
                    if (toolCallChunk.id) {
                        accumulatedToolCalls[index].id = toolCallChunk.id
                    }
                }
            }

            // Don't yield incomplete tool calls yet
            continue
        }

        // If we have content, yield it
        if (delta?.content) {
            yield {
                content: delta.content,
                additional_kwargs: {},
            }
        }

        // Check if the stream is finishing (finish_reason present)
        if (finishReason === 'tool_calls') {
            // Stream is done, yield accumulated tool calls
            const completedToolCalls = Object.values(accumulatedToolCalls)
            if (completedToolCalls.length > 0) {
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('🔧 STREAM: Yielding completed tool calls:', {
                        count: completedToolCalls.length,
                        calls: completedToolCalls.map(tc => ({
                            id: tc.id,
                            name: tc.function.name,
                            argsLength: tc.function.arguments.length,
                        })),
                    })
                }
                yield {
                    content: '',
                    additional_kwargs: {
                        tool_calls: completedToolCalls,
                    },
                }
            }
            accumulatedToolCalls = {} // Reset for next potential tool calls
        } else if (finishReason === 'stop') {
            if (ENABLE_DETAILED_LOGGING) {
                console.log('🔧 STREAM: Stream finished with reason: stop')
            }
        } else if (finishReason === 'length') {
            if (ENABLE_DETAILED_LOGGING) {
                console.log('🔧 STREAM: Stream finished with reason: length (max tokens)')
            }
        } else if (finishReason) {
            if (ENABLE_DETAILED_LOGGING) {
                console.log('🔧 STREAM: Stream finished with reason:', finishReason)
            }
        }
    }

    if (ENABLE_DETAILED_LOGGING) {
        console.log(`🔧 STREAM CONVERTER: Finished processing stream`, {
            totalChunks: chunkCount,
            totalContentLength,
            hadToolCalls: Object.keys(accumulatedToolCalls).length > 0,
            toolCallsCount: Object.keys(accumulatedToolCalls).length,
        })
    }
}

function formatMessage(objectType, message, assistantId) {
    const commentId = uuidv4()
    const now = Date.now()
    const comment = {
        commentText: message,
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        creatorId: assistantId,
        fromAssistant: true,
    }
    if (objectType === 'tasks') comment.commentType = STAYWARD_COMMENT
    return { commentId, comment }
}

const updateLastCommentDataOfChatParentObject = async (projectId, objectId, type, lastComment, commentType) => {
    const cleanedComment = shrinkTagText(
        cleanTextMetaData(removeFormatTagsFromText(lastComment), true),
        LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN
    )

    if (type === 'assistants') {
        await updateAssistantLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'contacts') {
        const promises = []
        promises.push(updateContactLastCommentData(projectId, objectId, cleanedComment, commentType))
        promises.push(updateUserLastCommentData(projectId, objectId, cleanedComment, commentType))
        await Promise.all(promises)
    } else if (type === 'skills') {
        await updateSkillLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'tasks') {
        await updateTaskLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'goals') {
        await updateGoalLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'notes') {
        await updateNoteLastCommentData(projectId, objectId, cleanedComment, commentType)
    }
}

const getFollowerLists = async (projectId, objectType, objectId, isPublicFor) => {
    let followerIds = await getObjectFollowersIds(projectId, objectType, objectId)

    followerIds = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        ? followerIds
        : followerIds.filter(uid => isPublicFor.includes(uid))

    return followerIds
}

const createChatInternalNotifications = (
    projectId,
    objectId,
    objectType,
    commentId,
    followrsMap,
    userIdsToNotify,
    assistantId,
    batch
) => {
    userIdsToNotify.forEach(userId => {
        batch.set(admin.firestore().doc(`chatNotifications/${projectId}/${userId}/${commentId}`), {
            chatId: objectId,
            chatType: objectType,
            followed: !!followrsMap[userId],
            date: moment().utc().valueOf(),
            creatorId: assistantId,
            creatorType: 'assistant',
        })
    })
}

const createChatEmailNotifications = (
    projectId,
    objectId,
    objectType,
    objectName,
    messageTimestamp,
    followerIds,
    batch
) => {
    // Check if followerIds array is not empty before using arrayUnion
    if (!followerIds || followerIds.length === 0) {
        console.log('No follower IDs for email notifications, skipping arrayUnion', { objectId })
        // Create with empty array instead of using arrayUnion
        batch.set(
            admin.firestore().doc(`emailNotifications/${objectId}`),
            {
                userIds: [],
                projectId,
                objectType: objectType === 'topics' ? 'chats' : objectType,
                objectId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )
    } else {
        // Normal case with follower IDs
        batch.set(
            admin.firestore().doc(`emailNotifications/${objectId}`),
            {
                userIds: followerIds, // Use array directly for emulator
                projectId,
                objectType: objectType === 'topics' ? 'chats' : objectType,
                objectId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )
    }
}

const createChatPushNotification = (
    projectId,
    objectId,
    followerIds,
    objectName,
    commentId,
    messageTimestamp,
    assistantName,
    projectname,
    comment,
    chatLink,
    initiatorId,
    batch
) => {
    // Check if followerIds array is not empty before creating notification
    if (!followerIds || followerIds.length === 0) {
        console.log('No follower IDs for push notifications, skipping notification creation', { objectId })
        return // Skip creating notification
    }

    // Normal case with follower IDs
    batch.set(admin.firestore().doc(`pushNotifications/${commentId}`), {
        userIds: followerIds,
        body: `${projectname}\n  ✔ ${objectName}\n ${assistantName} ${'commented'}: ${comment}`,
        link: chatLink,
        messageTimestamp,
        type: 'Chat Notification',
        chatId: objectId,
        projectId,
        initiatorId: initiatorId || null,
    })
}

const generateNotifications = (
    projectId,
    objectType,
    objectId,
    userIdsToNotify,
    objectName,
    assistantName,
    projectname,
    chatLink,
    commentId,
    lastComment,
    followerIds,
    assistantId,
    initiatorId = null
) => {
    // Ensure followerIds is at least an empty array if not provided
    const safeFollowerIds = followerIds || []

    if (safeFollowerIds.length === 0) {
        console.log('No followers to notify for this message', {
            projectId,
            objectType,
            objectId,
        })
    }

    const batch = new BatchWrapper(admin.firestore())
    const messageTimestamp = moment().utc().valueOf()
    const followersMap = {}
    safeFollowerIds.forEach(followerId => {
        followersMap[followerId] = true
    })

    // Only create notifications if there are followers or users to notify
    if (safeFollowerIds.length > 0 || (userIdsToNotify && userIdsToNotify.length > 0)) {
        createChatInternalNotifications(
            projectId,
            objectId,
            objectType,
            commentId,
            followersMap,
            userIdsToNotify,
            assistantId,
            batch
        )

        createChatEmailNotifications(
            projectId,
            objectId,
            objectType,
            objectName,
            messageTimestamp,
            safeFollowerIds,
            batch
        )

        createChatPushNotification(
            projectId,
            objectId,
            safeFollowerIds,
            objectName,
            commentId,
            messageTimestamp,
            assistantName,
            projectname,
            lastComment,
            chatLink,
            initiatorId,
            batch
        )
    }

    return batch.commit()
}

const getCurrentFollowerIds = async (followerIds, projectId, objectType, objectId, isPublicFor) => {
    try {
        // If followerIds is already provided, use that
        if (followerIds && Array.isArray(followerIds) && followerIds.length > 0) {
            console.log('Using provided follower IDs:', {
                followerCount: followerIds.length,
                projectId,
                objectType,
                objectId,
            })
            return followerIds
        }

        // Otherwise get follower IDs from the project
        console.log('Fetching follower IDs for object:', {
            projectId,
            objectType,
            objectId,
        })

        // Get the chat object first to get the taskId
        const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`).get()
        const chat = chatDoc.data()

        if (!chat || !chat.taskId) {
            console.log('No chat or taskId found:', { objectId })
            return []
        }

        // Get the task to find the creator - first try in project
        let taskDoc = await admin
            .firestore()
            .doc(`assistantTasks/${projectId}/${chat.assistantId}/${chat.taskId}`)
            .get()
        let task = taskDoc.data()

        // If not found, try in global projects
        if (!task || !task.creatorUserId) {
            console.log('Task not found in project, checking global projects:', { taskId: chat.taskId })
            taskDoc = await admin
                .firestore()
                .doc(`assistantTasks/globalProject/${chat.assistantId}/${chat.taskId}`)
                .get()
            task = taskDoc.data()
        }

        if (!task || !task.creatorUserId) {
            console.log('No task or creatorUserId found in project or global:', { taskId: chat.taskId })
            return []
        }

        console.log('Found task creator and using that as fallback for legacy tasks:', {
            taskId: chat.taskId,
            creatorUserId: task.creatorUserId,
        })

        // Return array with just the creator ID
        // NOTE: This is a fallback for legacy scenarios. Normally activatorUserId should be used.
        return [task.creatorUserId]
    } catch (error) {
        console.error('Error in getCurrentFollowerIds:', {
            error,
            projectId,
            objectType,
            objectId,
        })
        return [] // Return empty array on error
    }
}

const updateLastAssistantCommentData = async (projectId, objectType, objectId, currentFollowerIds, creatorId) => {
    if (!Array.isArray(currentFollowerIds) || currentFollowerIds.length === 0) {
        return
    }

    const batch = admin.firestore().batch()
    const timestamp = moment().utc().valueOf()

    currentFollowerIds.forEach(followerId => {
        const ref = admin.firestore().doc(`users/${followerId}`)
        const updateDate = { objectType, objectId, creatorId, creatorType: 'assistant', date: timestamp }

        batch.update(ref, {
            [`lastAssistantCommentData.${projectId}`]: updateDate,
            [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: {
                ...updateDate,
                projectId,
            },
        })
    })

    await batch.commit()
}

/**
 * Execute a tool natively and return the raw result (not processed by LLM)
 * This is used for OpenAI native tool calling
 */
async function executeToolNatively(toolName, toolArgs, projectId, assistantId, requestUserId, userContext) {
    console.log('🔧 executeToolNatively:', { toolName, toolArgs, projectId })

    const admin = require('firebase-admin')

    // Get creator ID - use requestUserId if available, otherwise use assistantId
    const creatorId = requestUserId || assistantId

    switch (toolName) {
        case 'create_task': {
            const { TaskService } = require('../shared/TaskService')
            const { UserHelper } = require('../shared/UserHelper')
            const moment = require('moment-timezone')
            const db = admin.firestore()

            // Determine target project ID with four-level fallback (matching MCP behavior)
            // 1. Explicit projectId in toolArgs (highest priority)
            // 2. Project name resolution (if projectName provided)
            // 3. Chat context projectId (assistant-specific fallback)
            // 4. User's default project (matching MCP behavior)
            let targetProjectId = toolArgs.projectId

            // Project name resolution (if name provided but no ID)
            if (!targetProjectId && toolArgs.projectName) {
                const { ProjectService } = require('../shared/ProjectService')
                const projectService = new ProjectService({ database: db })
                await projectService.initialize()

                const projects = await projectService.getUserProjects(creatorId, {
                    includeArchived: false,
                    includeCommunity: false,
                })

                // Case-insensitive partial match
                const matchingProject = projects.find(
                    p => p.name && p.name.toLowerCase().includes(toolArgs.projectName.toLowerCase())
                )

                if (matchingProject) {
                    targetProjectId = matchingProject.id
                    console.log('📝 CREATE_TASK TOOL: Resolved project name to ID', {
                        projectName: toolArgs.projectName,
                        projectId: matchingProject.id,
                        projectFullName: matchingProject.name,
                    })
                } else {
                    throw new Error(`Project not found: "${toolArgs.projectName}"`)
                }
            }

            // Fallback to chat context projectId
            if (!targetProjectId) {
                targetProjectId = projectId
            }

            // If still no projectId, try user's default project (matching MCP)
            if (!targetProjectId) {
                try {
                    const db = admin.firestore()
                    const userDoc = await db.collection('users').doc(creatorId).get()
                    if (userDoc.exists) {
                        targetProjectId = userDoc.data().defaultProjectId || null
                    }
                } catch (error) {
                    console.error('Error getting user default project:', error)
                }
            }

            if (!targetProjectId) {
                throw new Error(
                    'No project specified and no default project found. Please specify a projectId, projectName, or set a default project.'
                )
            }

            console.log('📝 CREATE_TASK TOOL: Project selection', {
                toolArgsProjectId: toolArgs.projectId,
                toolArgsProjectName: toolArgs.projectName,
                contextProjectId: projectId,
                selectedProjectId: targetProjectId,
                source: toolArgs.projectId
                    ? 'toolArgs.projectId'
                    : toolArgs.projectName
                    ? 'toolArgs.projectName'
                    : projectId
                    ? 'context'
                    : 'defaultProject',
            })

            // Get user data for feed creation and timezone
            const feedUser = await UserHelper.getFeedUserData(db, creatorId)

            // Get user's timezone for date parsing (normalize across possible fields)
            const userDoc = await db.collection('users').doc(creatorId).get()
            const userData = userDoc.data()
            let timezoneOffset = 0
            try {
                const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
                const rawTz =
                    (typeof userData?.timezone !== 'undefined' ? userData.timezone : null) ??
                    (typeof userData?.timezoneOffset !== 'undefined' ? userData.timezoneOffset : null) ??
                    (typeof userData?.timezoneMinutes !== 'undefined' ? userData.timezoneMinutes : null) ??
                    (typeof userData?.preferredTimezone !== 'undefined' ? userData.preferredTimezone : null)
                const normalized = TaskRetrievalService.normalizeTimezoneOffset(rawTz)
                timezoneOffset = typeof normalized === 'number' ? normalized : timezoneOffset
            } catch (_) {}

            console.log('📝 CREATE_TASK TOOL: User timezone info', {
                userId: creatorId,
                timezoneOffset,
                hasTimezone: !!userData?.timezone,
            })

            // Handle dueDate with timezone conversion if it's a string
            let processedDueDate = toolArgs.dueDate
            if (toolArgs.dueDate && typeof toolArgs.dueDate === 'string') {
                console.log('📝 CREATE_TASK TOOL: Processing dueDate ISO string with timezone', {
                    originalDueDate: toolArgs.dueDate,
                    timezoneOffset,
                })

                // Respect embedded timezone if present; otherwise interpret as user's local time
                const parsed = moment.parseZone(toolArgs.dueDate)
                if (
                    parsed &&
                    parsed.isValid() &&
                    parsed.utcOffset() !== 0 &&
                    /[zZ]|[+-]\d{2}:?\d{2}$/.test(toolArgs.dueDate)
                ) {
                    processedDueDate = parsed.valueOf()
                } else {
                    // Interpret provided local clock time in user's timezone and convert to UTC ms
                    processedDueDate = moment(toolArgs.dueDate).utcOffset(timezoneOffset, true).valueOf()
                }

                console.log('📝 CREATE_TASK TOOL: Converted dueDate', {
                    from: toolArgs.dueDate,
                    to: processedDueDate,
                    asDate: new Date(processedDueDate).toISOString(),
                })
            }

            // Validate alert requirements
            if (toolArgs.alertEnabled && !processedDueDate) {
                throw new Error('Cannot enable alert without setting a due date/reminder time')
            }

            // Initialize or reuse TaskService instance (performance optimization)
            if (!cachedTaskService) {
                cachedTaskService = new TaskService({
                    database: db,
                    moment: moment,
                    idGenerator: () => db.collection('_').doc().id,
                    enableFeeds: true,
                    enableValidation: true,
                    isCloudFunction: true,
                    taskBatchSize: 100,
                    maxBatchesPerProject: 20,
                })
                await cachedTaskService.initialize()
            }

            try {
                // Create task using unified service
                const result = await cachedTaskService.createAndPersistTask(
                    {
                        name: toolArgs.name,
                        description: toolArgs.description || '',
                        dueDate: processedDueDate,
                        userId: creatorId,
                        projectId: targetProjectId,
                        isPrivate: false,
                        feedUser,
                    },
                    {
                        userId: creatorId,
                        projectId: targetProjectId,
                    }
                )

                // Handle alert if alertEnabled is true
                if (toolArgs.alertEnabled && processedDueDate) {
                    console.log('📝 CREATE_TASK TOOL: Enabling alert', {
                        taskId: result.taskId,
                        dueDate: processedDueDate,
                    })

                    const { setTaskAlertCloud } = require('../shared/AlertService')

                    // Convert UTC timestamp to moment with user's timezone for setTaskAlert
                    const alertMoment = moment(processedDueDate).utcOffset(timezoneOffset)

                    console.log('📝 CREATE_TASK TOOL: Calling setTaskAlert', {
                        taskId: result.taskId,
                        projectId: targetProjectId,
                        alertTime: alertMoment.format('YYYY-MM-DD HH:mm:ss'),
                    })

                    // Update alert server-side (Cloud)
                    await setTaskAlertCloud(targetProjectId, result.taskId, true, alertMoment, {
                        ...result.task,
                        dueDate: processedDueDate,
                    })

                    console.log('📝 CREATE_TASK TOOL: Alert enabled successfully')
                }

                return {
                    success: result.success,
                    taskId: result.taskId,
                    message: result.message,
                    task: result.task,
                }
            } catch (error) {
                console.error('Error creating task:', error)
                throw new Error(`Failed to create task: ${error.message}`)
            }
        }

        case 'create_note': {
            const { NoteService } = require('../shared/NoteService')
            const { UserHelper } = require('../shared/UserHelper')
            const db = admin.firestore()

            // Get user data for feed creation using shared helper
            const feedUser = await UserHelper.getFeedUserData(db, creatorId)

            // Initialize or reuse NoteService instance (performance optimization)
            if (!cachedNoteService) {
                cachedNoteService = new NoteService({
                    database: db,
                    moment: moment,
                    idGenerator: () => db.collection('_').doc().id,
                    enableFeeds: true,
                    enableValidation: true,
                    isCloudFunction: true,
                })
                await cachedNoteService.initialize()
            }

            try {
                // Create note using unified service
                const result = await cachedNoteService.createAndPersistNote(
                    {
                        title: toolArgs.title,
                        content: toolArgs.content,
                        userId: creatorId,
                        projectId: projectId,
                        isPrivate: false,
                        feedUser,
                    },
                    {
                        userId: creatorId,
                        projectId: projectId,
                    }
                )

                return {
                    success: result.success,
                    noteId: result.noteId,
                    message: result.message,
                    note: result.note,
                }
            } catch (error) {
                console.error('Error creating note:', error)
                throw new Error(`Failed to create note: ${error.message}`)
            }
        }

        case 'get_tasks': {
            const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
            const { ProjectService } = require('../shared/ProjectService')

            // Get user data
            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }
            const userData = userDoc.data()

            // Normalize user's timezone for proper calendar time conversion
            const timezoneOffset = TaskRetrievalService.normalizeTimezoneOffset(userData?.timezone)

            // Get projects with database interface
            const projectService = new ProjectService({
                database: admin.firestore(),
            })
            await projectService.initialize()

            const includeArchived = toolArgs.includeArchived || false
            const includeCommunity = toolArgs.includeCommunity || false

            const projectsData = await projectService.getUserProjects(creatorId, {
                includeArchived,
                includeCommunity,
            })

            // Initialize TaskRetrievalService with database
            const retrievalService = new TaskRetrievalService({
                database: admin.firestore(),
                moment: require('moment'),
                isCloudFunction: true,
            })
            await retrievalService.initialize()

            // If allProjects is true, get tasks from all projects
            let tasks = []
            if (toolArgs.allProjects) {
                const projectIds = projectsData.map(p => p.id)
                const result = await retrievalService.getTasksFromMultipleProjects(
                    {
                        userId: creatorId,
                        status: toolArgs.status || 'open',
                        date: toolArgs.date || null,
                        limit: 100,
                        selectMinimalFields: true,
                        timezoneOffset,
                    },
                    projectIds,
                    projectsData.reduce((acc, p) => {
                        acc[p.id] = p
                        return acc
                    }, {})
                )
                tasks = result.tasks || []
            } else {
                // Get tasks from single project
                const result = await retrievalService.getTasks({
                    projectId: projectId,
                    userId: creatorId,
                    status: toolArgs.status || 'open',
                    date: toolArgs.date || null,
                    limit: 100,
                    selectMinimalFields: true,
                    timezoneOffset,
                })
                tasks = result.tasks || []
            }

            return {
                tasks: tasks.map(t => ({
                    id: t.documentId || t.id,
                    name: t.name,
                    completed: t.completed,
                    projectName: t.projectName,
                    dueDate: t.dueDate,
                    humanReadableId: t.humanReadableId || null,
                    sortIndex: t.sortIndex || 0,
                    parentGoal: t.parentGoal || null,
                    calendarTime: t.calendarTime || null,
                    isFocus: t.isFocus || false,
                })),
                count: tasks.length,
            }
        }

        case 'get_user_projects': {
            const { ProjectService } = require('../shared/ProjectService')

            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }
            const userData = userDoc.data()

            const projectService = new ProjectService({
                database: admin.firestore(),
            })
            await projectService.initialize()

            const includeArchived = toolArgs.includeArchived || false
            const includeCommunity = toolArgs.includeCommunity || false

            const projects = await projectService.getUserProjects(creatorId, {
                includeArchived,
                includeCommunity,
            })

            return {
                projects: projects.map(p => ({
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    description: p.description,
                })),
                count: projects.length,
            }
        }

        case 'get_focus_task': {
            const { FocusTaskService } = require('../shared/FocusTaskService')
            const { TaskRetrievalService } = require('../shared/TaskRetrievalService')

            // Get user's timezone for proper date/time calculations
            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            const userData = userDoc.exists ? userDoc.data() : {}
            const timezoneOffset = TaskRetrievalService.normalizeTimezoneOffset(userData?.timezone)

            console.log('📝 GET_FOCUS_TASK TOOL: User timezone info', {
                userId: creatorId,
                timezoneOffset,
                hasTimezone: !!userData?.timezone,
            })

            const focusTaskService = new FocusTaskService({
                database: admin.firestore(),
                moment: require('moment'),
                isCloudFunction: true,
            })
            await focusTaskService.initialize()

            // Use projectId from tool args if provided, otherwise null for cross-project search
            // This matches the MCP implementation and enables intelligent cross-project prioritization
            const targetProjectId = toolArgs.projectId || null

            // Support forceNew parameter for "what should I work on next?" queries
            const forceNew = toolArgs.forceNew || false

            const result = await focusTaskService.getFocusTask(creatorId, targetProjectId, {
                selectMinimalFields: true,
                forceNew: forceNew,
                timezoneOffset: timezoneOffset,
            })

            return {
                success: result.success,
                focusTask: result.focusTask,
                wasNewTaskSet: result.wasNewTaskSet,
                message: result.message,
            }
        }

        case 'update_task': {
            console.log('📝 UPDATE_TASK TOOL: Starting task update', {
                creatorId,
                projectId,
                toolArgs,
                isBulkUpdate: toolArgs.updateAll || false,
            })

            const db = admin.firestore()

            // Initialize TaskUpdateService if not already done
            if (!this.taskUpdateService) {
                const TaskUpdateService = require('../shared/TaskUpdateService')
                const moment = require('moment-timezone')
                this.taskUpdateService = new TaskUpdateService({
                    database: db,
                    moment: moment,
                    isCloudFunction: true,
                })
                await this.taskUpdateService.initialize()
            }

            // Use shared service for find and update
            // toolArgs contains: taskId, taskName, projectId, projectName, completed, focus, name, description, dueDate, alertEnabled, estimation, updateAll
            try {
                const result = await this.taskUpdateService.findAndUpdateTask(
                    creatorId,
                    toolArgs, // searchCriteria (includes projectId for filtering)
                    toolArgs, // updateFields (includes estimation, completed, focus, etc.)
                    {
                        autoSelectOnHighConfidence: true,
                        highConfidenceThreshold: 800,
                        dominanceMargin: 300,
                        maxOptionsToShow: 5,
                        updateAll: toolArgs.updateAll || false, // Enable bulk update if requested
                    }
                )

                console.log('📝 UPDATE_TASK TOOL: Result', {
                    success: result.success,
                    message: result.message,
                    isBulkUpdate: !!result.updated,
                    tasksUpdated: result.updated?.length || 1,
                })

                return result
            } catch (error) {
                console.error('📝 UPDATE_TASK TOOL: Task update failed', {
                    error: error.message,
                    stack: error.stack,
                })
                throw error
            }
        }

        case 'update_note': {
            const { NoteService } = require('../shared/NoteService')
            const { SearchService } = require('../shared/SearchService')
            const { UserHelper } = require('../shared/UserHelper')
            const db = admin.firestore()

            // Initialize or reuse SearchService instance (performance optimization)
            if (!cachedSearchService) {
                cachedSearchService = new SearchService({
                    database: db,
                    moment: moment,
                    enableAlgolia: true,
                    enableNoteContent: true,
                    enableDateParsing: true,
                    isCloudFunction: true,
                })
                await cachedSearchService.initialize()
            }

            // Step 1: Note Discovery - get final result from SearchService
            let searchResult = await cachedSearchService.findNoteForUpdateWithResults(
                creatorId,
                {
                    noteTitle: toolArgs.noteTitle,
                    noteId: toolArgs.noteId, // Optional direct lookup
                    projectName: toolArgs.projectName, // Optional project filter
                    projectId: toolArgs.projectName ? undefined : projectId, // Use current context project as default ONLY if no project name specified
                },
                {
                    // Tune confidence for internal assistant to be more aggressive
                    highConfidenceThreshold: 600, // Lower from default 800
                    dominanceMargin: 200, // Lower from default 300
                }
            )

            // Handle search failure - match MCP behavior
            if (!searchResult.success) {
                if (searchResult.error === 'NO_MATCHES') {
                    throw new Error(searchResult.message)
                } else if (searchResult.error === 'MULTIPLE_MATCHES') {
                    // Return match info to LLM instead of throwing (MCP pattern)
                    return {
                        success: false,
                        message: searchResult.message,
                        confidence: searchResult.confidence,
                        reasoning: searchResult.reasoning,
                        matches: searchResult.matches,
                        totalMatches: searchResult.totalMatches,
                    }
                } else {
                    throw new Error(searchResult.message)
                }
            }

            // Step 2: Note Update - proceed with selected note
            const currentNote = searchResult.selectedNote
            const currentProjectId = searchResult.projectId
            const currentProjectName = searchResult.projectName

            // Get user data for feed creation using shared helper
            const feedUser = await UserHelper.getFeedUserData(db, creatorId)

            // Initialize or reuse NoteService instance (performance optimization)
            if (!cachedNoteService) {
                cachedNoteService = new NoteService({
                    database: db,
                    moment: moment,
                    idGenerator: () => db.collection('_').doc().id,
                    enableFeeds: true,
                    enableValidation: false, // Skip validation since we already validated
                    isCloudFunction: true,
                })
                await cachedNoteService.initialize()
            }

            try {
                console.log('Internal Assistant: Using NoteService for note update with feed generation')

                // Update note using unified service (NoteService automatically adds timestamp)
                const result = await cachedNoteService.updateAndPersistNote({
                    noteId: currentNote.id,
                    projectId: currentProjectId,
                    currentNote: currentNote,
                    content: toolArgs.content,
                    title: toolArgs.title, // Optional: for renaming the note
                    feedUser: feedUser,
                })

                console.log('Note updated via NoteService:', {
                    noteId: currentNote.id,
                    projectId: currentProjectId,
                    changes: result.changes,
                    feedGenerated: !!result.feedData,
                    persisted: result.persisted,
                })

                // Build success message showing what changed (match MCP format)
                const changes = result.changes || []
                let message = `Note "${currentNote.title || 'Untitled'}" updated successfully`
                if (changes.length > 0) {
                    message += ` (${changes.join(', ')})`
                }
                message += ` in project "${currentProjectName}"`

                // Add content preview/confirmation so assistant knows exactly what was saved
                // This prevents hallucination of a different summary in the final response
                if (toolArgs.content) {
                    message += `.\n\nContent added:\n"${toolArgs.content}"`
                }

                // Add search reasoning to the update result for transparency (MCP pattern)
                if (searchResult.isAutoSelected) {
                    message += ` (${searchResult.reasoning})`
                }

                // Fetch full content for accurate summary
                let fullContent = ''
                try {
                    fullContent = await cachedNoteService.getStorageContent(currentProjectId, currentNote.id)
                    console.log('Internal Assistant: Fetched full content for summary:', fullContent.length)
                } catch (contentError) {
                    console.warn('Internal Assistant: Failed to fetch full content:', contentError.message)
                    // Fallback to what we have (might be truncated or empty)
                    fullContent = toolArgs.content || ''
                }

                return {
                    success: true,
                    noteId: currentNote.id,
                    message,
                    note: {
                        ...(result.updatedNote || { id: currentNote.id, ...currentNote }),
                        content: fullContent, // Ensure full content is returned
                    },
                    project: { id: currentProjectId, name: currentProjectName },
                    changes: changes,
                }
            } catch (error) {
                console.error('NoteService update failed:', error)
                throw new Error(`Failed to update note: ${error.message}`)
            }
        }

        case 'search': {
            console.log('🔍 SEARCH TOOL: Starting search execution', {
                creatorId,
                query: toolArgs.query,
                type: toolArgs.type || 'all',
                projectId: toolArgs.projectId || projectId,
                dateRange: toolArgs.dateRange || null,
            })

            const { SearchService } = require('../shared/SearchService')
            const moment = require('moment')

            // Initialize SearchService with full capabilities
            const searchService = new SearchService({
                database: admin.firestore(),
                moment: moment,
                enableAlgolia: true,
                enableNoteContent: true,
                enableDateParsing: true,
                isCloudFunction: true,
            })
            await searchService.initialize()
            console.log('🔍 SEARCH TOOL: SearchService initialized')

            // Execute search
            const result = await searchService.search(creatorId, {
                query: toolArgs.query,
                type: toolArgs.type || 'all',
                projectId: toolArgs.projectId || projectId,
                dateRange: toolArgs.dateRange || null,
            })
            console.log('🔍 SEARCH TOOL: Search completed', {
                tasksCount: result.results.tasks?.length || 0,
                notesCount: result.results.notes?.length || 0,
                goalsCount: result.results.goals?.length || 0,
                contactsCount: result.results.contacts?.length || 0,
                chatsCount: result.results.chats?.length || 0,
                assistantsCount: result.results.assistants?.length || 0,
            })

            // Format results for assistant
            const summary = []
            let totalResults = 0

            if (result.results.tasks && result.results.tasks.length > 0) {
                summary.push(`${result.results.tasks.length} tasks`)
                totalResults += result.results.tasks.length
            }
            if (result.results.notes && result.results.notes.length > 0) {
                summary.push(`${result.results.notes.length} notes`)
                totalResults += result.results.notes.length
            }
            if (result.results.goals && result.results.goals.length > 0) {
                summary.push(`${result.results.goals.length} goals`)
                totalResults += result.results.goals.length
            }
            if (result.results.contacts && result.results.contacts.length > 0) {
                summary.push(`${result.results.contacts.length} contacts`)
                totalResults += result.results.contacts.length
            }
            if (result.results.chats && result.results.chats.length > 0) {
                summary.push(`${result.results.chats.length} chats`)
                totalResults += result.results.chats.length
            }
            if (result.results.assistants && result.results.assistants.length > 0) {
                summary.push(`${result.results.assistants.length} assistants`)
                totalResults += result.results.assistants.length
            }

            const searchResult = {
                success: true,
                query: result.query,
                results: result.results,
                totalResults: totalResults,
                summary: totalResults > 0 ? `Found ${summary.join(', ')}` : 'No results found',
                searchedProjects: result.searchedProjects || [],
            }

            console.log('🔍 SEARCH TOOL: Returning result', {
                success: searchResult.success,
                totalResults: searchResult.totalResults,
                summary: searchResult.summary,
                resultLength: JSON.stringify(searchResult).length,
            })

            return searchResult
        }

        case 'get_note': {
            console.log('📝 GET_NOTE TOOL: Starting note retrieval', {
                creatorId,
                noteId: toolArgs.noteId,
                projectId: toolArgs.projectId,
            })

            const { SearchService } = require('../shared/SearchService')
            const moment = require('moment')

            // Initialize SearchService for note retrieval
            const searchService = new SearchService({
                database: admin.firestore(),
                moment: moment,
                enableAlgolia: true,
                enableNoteContent: true,
                enableDateParsing: true,
                isCloudFunction: true,
            })
            await searchService.initialize()
            console.log('📝 GET_NOTE TOOL: SearchService initialized')

            // Retrieve full note content
            const note = await searchService.getNote(creatorId, toolArgs.noteId, toolArgs.projectId)
            console.log('📝 GET_NOTE TOOL: Note retrieved', {
                noteId: note.id,
                title: note.title,
                contentLength: note.content?.length || 0,
                contentPreview: note.content?.substring(0, 200),
                projectId: note.projectId,
                projectName: note.projectName,
                wordCount: note.metadata?.wordCount || 0,
            })

            const result = {
                success: true,
                note: {
                    id: note.id,
                    title: note.title,
                    content: note.content,
                    projectId: note.projectId,
                    projectName: note.projectName,
                    createdAt: note.createdAt,
                    updatedAt: note.updatedAt,
                    wordCount: note.metadata?.wordCount || 0,
                },
            }

            console.log('📝 GET_NOTE TOOL: Returning result', {
                success: result.success,
                resultLength: JSON.stringify(result).length,
            })

            return result
        }

        default:
            throw new Error(`Unknown tool: ${toolName}`)
    }
}

async function storeChunks(
    projectId,
    objectType,
    objectId,
    userIdsToNotify,
    stream,
    parser,
    assistantId,
    isPublicFor,
    followerIds,
    objectName,
    assistantName,
    projectname,
    chatLink,
    requestUserId,
    userContext = null,
    conversationHistory = null,
    modelKey = null,
    temperatureKey = null,
    allowedTools = []
) {
    const chunksStartTime = Date.now()
    console.log('🔄 [TIMING] storeChunks START', {
        timestamp: new Date().toISOString(),
        projectId,
        objectType,
        objectId,
        hasStream: !!stream,
        assistantId,
    })

    try {
        // Step 1: Create initial comment
        const step1Start = Date.now()
        const { commentId, comment } = formatMessage(objectType, '', assistantId)

        let promises = []
        promises.push(getCurrentFollowerIds(followerIds, projectId, objectType, objectId, isPublicFor))
        promises.push(
            admin
                .firestore()
                .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
                .set(comment)
        )

        const [currentFollowerIds] = await Promise.all(promises)
        const step1Duration = Date.now() - step1Start

        console.log(`📊 [TIMING] Initial setup: ${step1Duration}ms`, {
            commentId,
            followerCount: currentFollowerIds?.length,
        })

        let commentText = ''
        let thinkingMode = false
        let thinkingContent = ''
        let answerContent = ''
        let chunkCount = 0
        let toolAlreadyExecuted = false

        // Create a reference to the comment document for updates
        const commentRef = admin
            .firestore()
            .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)

        // Batch update mechanism to reduce Firestore writes
        let pendingUpdate = null
        let updateTimeout = null
        const BATCH_UPDATE_DELAY_MS = 300 // Update every 300ms max (increased for better performance)
        const BATCH_UPDATE_CHUNK_THRESHOLD = 10 // Or every 10 chunks, whichever comes first (increased for better performance)

        const flushPendingUpdate = async () => {
            if (pendingUpdate) {
                const updateData = { ...pendingUpdate }
                pendingUpdate = null
                if (updateTimeout) {
                    clearTimeout(updateTimeout)
                    updateTimeout = null
                }
                await commentRef.update(updateData)
            }
        }

        const scheduleUpdate = async (updateData, immediate = false) => {
            // Merge with pending update
            pendingUpdate = { ...pendingUpdate, ...updateData }

            if (immediate) {
                // Flush immediately for critical updates (loading states, tool calls, etc.)
                await flushPendingUpdate()
                return
            }

            // Clear existing timeout
            if (updateTimeout) {
                clearTimeout(updateTimeout)
            }

            // Schedule update after delay or when threshold reached
            updateTimeout = setTimeout(async () => {
                await flushPendingUpdate()
            }, BATCH_UPDATE_DELAY_MS)
        }

        // Process each chunk from the stream
        const streamProcessStart = Date.now()
        let firstChunkTime = null
        let lastChunkTime = Date.now()
        let chunksSinceLastUpdate = 0
        console.log('🚀 [TIMING] Starting stream processing...')

        // Track time-to-first-token from function start (use global if available)
        const timeToFirstTokenStart = globalFunctionStartTime || streamProcessStart

        console.log('🚀 [TIMING] About to enter stream loop in storeChunks')
        for await (const chunk of stream) {
            chunkCount++
            const chunkTime = Date.now()

            if (!firstChunkTime) {
                firstChunkTime = chunkTime
                const timeToFirstToken = firstChunkTime - timeToFirstTokenStart
                const timeFromStreamStart = firstChunkTime - streamProcessStart
                const timeFromInitialSetup = firstChunkTime - chunksStartTime
                console.log(`⚡ [TIMING] FIRST TOKEN RECEIVED`, {
                    timeToFirstToken: `${timeToFirstToken}ms`,
                    timeFromStreamStart: `${timeFromStreamStart}ms`,
                    timeFromInitialSetup: `${timeFromInitialSetup}ms`,
                    timestamp: new Date().toISOString(),
                    functionStartTime: timeToFirstTokenStart,
                    firstChunkTime: firstChunkTime,
                    breakdown: {
                        fromEntryPoint: `${timeToFirstToken}ms`,
                        fromStreamStart: `${timeFromStreamStart}ms`,
                        fromInitialSetup: `${timeFromInitialSetup}ms`,
                    },
                })
            }

            if (ENABLE_DETAILED_LOGGING) {
                console.log(`📦 [TIMING] Chunk #${chunkCount}:`, {
                    timeSinceLastChunk: `${chunkTime - lastChunkTime}ms`,
                    timeSinceStart: `${chunkTime - streamProcessStart}ms`,
                    hasContent: !!chunk.content,
                    contentLength: chunk.content?.length,
                    isLoading: chunk.isLoading,
                    isThinking: chunk.isThinking,
                    clearThinkingMode: chunk.clearThinkingMode,
                    hasReplacementContent: !!chunk.replacementContent,
                })
            }

            lastChunkTime = chunkTime

            // If a tool was already executed, skip all remaining chunks from the stream
            if (toolAlreadyExecuted) {
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('Tool already executed, discarding remaining stream chunk')
                }
                continue
            }

            // Handle native OpenAI tool calls (from GPT models with native tool calling)
            if (chunk.additional_kwargs?.tool_calls && Array.isArray(chunk.additional_kwargs.tool_calls)) {
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('🔧 NATIVE TOOL CALL: Detected native tool call', {
                        toolCallsCount: chunk.additional_kwargs.tool_calls.length,
                        toolCalls: chunk.additional_kwargs.tool_calls.map(tc => ({
                            id: tc.id,
                            name: tc.function?.name,
                            argsLength: tc.function?.arguments?.length,
                        })),
                    })
                }

                // Check if we have conversation history to resume with
                if (!conversationHistory || !modelKey || !temperatureKey) {
                    console.warn(
                        '🔧 NATIVE TOOL CALL: Missing conversation history or model info - tools disabled for this model'
                    )
                    await flushPendingUpdate() // Flush any pending updates first
                    commentText += '\n\n[Tools are only available for GPT models]'
                    await commentRef.update({ commentText, isLoading: false })
                    toolAlreadyExecuted = true
                    continue
                }

                // Execute tool calls in a loop to support multi-step tool calling
                let currentConversation = conversationHistory
                let currentToolCalls = chunk.additional_kwargs.tool_calls
                let toolCallIteration = 0
                const MAX_TOOL_ITERATIONS = 10 // Prevent infinite loops

                while (currentToolCalls && currentToolCalls.length > 0 && toolCallIteration < MAX_TOOL_ITERATIONS) {
                    toolCallIteration++
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Starting tool call iteration #' + toolCallIteration, {
                            toolCallsCount: currentToolCalls.length,
                            maxIterations: MAX_TOOL_ITERATIONS,
                        })
                    }

                    // Process first tool call (OpenAI typically sends one at a time)
                    const toolCall = currentToolCalls[0]
                    const toolName = toolCall.function.name
                    const toolCallId = toolCall.id

                    // Parse arguments
                    let toolArgs = {}
                    try {
                        toolArgs = JSON.parse(toolCall.function.arguments)
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Parsed arguments', { toolName, toolArgs })
                        }
                    } catch (e) {
                        console.error('🔧 NATIVE TOOL CALL: Failed to parse arguments', e)
                        commentText += `\n\nError: Failed to parse tool arguments for ${toolName}`
                        await commentRef.update({ commentText, isLoading: false })
                        toolAlreadyExecuted = true
                        break // Exit the while loop
                    }

                    // Check permissions
                    const assistant = await getAssistantForChat(projectId, assistantId)
                    const allowed = Array.isArray(assistant.allowedTools) && assistant.allowedTools.includes(toolName)

                    if (!allowed) {
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Tool not permitted', { toolName })
                        }
                        await flushPendingUpdate() // Flush any pending updates first
                        commentText += `\n\nTool not permitted: ${toolName}`
                        await commentRef.update({ commentText, isLoading: false })
                        toolAlreadyExecuted = true
                        break // Exit the while loop
                    }

                    // Show loading indicator
                    await flushPendingUpdate() // Flush any pending updates first
                    const loadingMessage = `⏳ Executing ${toolName}...`
                    commentText += `\n\n${loadingMessage}`
                    await commentRef.update({ commentText, isLoading: true })

                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Executing tool', { toolName, toolArgs })
                    }

                    // Execute tool and get result
                    let toolResult
                    try {
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Starting tool execution', { toolName, toolArgs })
                        }
                        toolResult = await executeToolNatively(
                            toolName,
                            toolArgs,
                            projectId,
                            assistantId,
                            requestUserId,
                            userContext
                        )
                        const toolResultString = JSON.stringify(toolResult, null, 2)
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Tool executed successfully', {
                                toolName,
                                resultLength: toolResultString.length,
                                resultPreview: toolResultString.substring(0, 500),
                                fullResult:
                                    toolResultString.length < 1000 ? toolResultString : '[Too large to display fully]',
                            })
                        }
                    } catch (error) {
                        console.error('🔧 NATIVE TOOL CALL: Tool execution failed', {
                            toolName,
                            error: error.message,
                            stack: error.stack,
                        })
                        await flushPendingUpdate() // Flush any pending updates first
                        const errorMsg = `Error executing ${toolName}: ${error.message}`
                        commentText = commentText.replace(loadingMessage, errorMsg)
                        await commentRef.update({ commentText, isLoading: false })
                        toolAlreadyExecuted = true
                        break // Exit the while loop
                    }

                    // Build new conversation history with tool result
                    // Need to add: assistant's message with tool call, then tool result message

                    // Collect all assistant content before tool call
                    const assistantMessageContent = commentText.replace(loadingMessage, '').trim()
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Building conversation update', {
                            assistantMessageContentLength: assistantMessageContent.length,
                            assistantMessageContent: assistantMessageContent.substring(0, 200),
                        })
                    }

                    // Build updated conversation with plain objects
                    const updatedConversation = [
                        ...currentConversation,
                        {
                            role: 'assistant',
                            content: assistantMessageContent,
                            tool_calls: [
                                {
                                    id: toolCallId,
                                    type: 'function',
                                    function: {
                                        name: toolName,
                                        arguments: JSON.stringify(toolArgs),
                                    },
                                },
                            ],
                        },
                        {
                            role: 'tool',
                            content: JSON.stringify(toolResult),
                            tool_call_id: toolCallId,
                        },
                        {
                            role: 'user',
                            content:
                                'Based on the tool results above, please provide your response to the user. If you need additional information, you may call other available tools.',
                        },
                    ]

                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Built updated conversation', {
                            conversationLength: updatedConversation.length,
                            originalHistoryLength: currentConversation.length,
                            toolResultLength: JSON.stringify(toolResult).length,
                            toolResultPreview: JSON.stringify(toolResult).substring(0, 500),
                            iteration: toolCallIteration,
                            lastThreeMessages: updatedConversation.slice(-3).map(m => ({
                                role: m.role,
                                hasContent: !!m.content,
                                contentLength: m.content?.length,
                                contentPreview: m.content?.substring(0, 150),
                                hasToolCalls: !!m.tool_calls,
                                toolCallsCount: m.tool_calls?.length,
                                hasToolCallId: !!m.tool_call_id,
                            })),
                        })
                    }

                    // Update currentConversation for next iteration
                    currentConversation = updatedConversation

                    // Resume stream with updated conversation
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Calling interactWithChatStream with updated conversation', {
                            modelKey,
                            temperatureKey,
                            allowedToolsCount: allowedTools?.length,
                            allowedTools,
                            iteration: toolCallIteration,
                        })
                    }
                    const newStream = await interactWithChatStream(
                        updatedConversation,
                        modelKey,
                        temperatureKey,
                        allowedTools
                    )
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Got new stream from interactWithChatStream')
                    }

                    // Remove loading indicator
                    await flushPendingUpdate() // Flush any pending updates first
                    commentText = commentText.replace(loadingMessage, '')
                    await commentRef.update({ commentText, isLoading: false })

                    // Process the new stream - replace the current stream
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Starting to process resumed stream chunks')
                    }

                    // Process all chunks from the new stream
                    let resumedChunkCount = 0
                    let totalContentReceived = 0
                    let nextToolCalls = null

                    for await (const newChunk of newStream) {
                        resumedChunkCount++

                        const logData = {
                            iteration: toolCallIteration,
                            chunkNumber: resumedChunkCount,
                            hasContent: !!newChunk.content,
                            contentLength: newChunk.content?.length || 0,
                            content: newChunk.content || '',
                            hasAdditionalKwargs: !!newChunk.additional_kwargs,
                            additionalKwargs: newChunk.additional_kwargs,
                        }

                        // Check if this chunk contains new tool calls (multi-step reasoning)
                        if (newChunk.additional_kwargs?.tool_calls) {
                            if (ENABLE_DETAILED_LOGGING) {
                                console.log('🔧 NATIVE TOOL CALL: RESUMED STREAM CONTAINS ADDITIONAL TOOL CALLS!', {
                                    ...logData,
                                    toolCallsCount: newChunk.additional_kwargs.tool_calls.length,
                                    toolCalls: newChunk.additional_kwargs.tool_calls.map(tc => ({
                                        id: tc.id,
                                        name: tc.function?.name,
                                        args: tc.function?.arguments,
                                    })),
                                })
                            }
                            // Store the tool calls to execute in next iteration
                            nextToolCalls = newChunk.additional_kwargs.tool_calls
                            // Don't break yet - let the stream finish
                        } else {
                            if (ENABLE_DETAILED_LOGGING) {
                                console.log('🔧 NATIVE TOOL CALL: Resumed stream chunk #' + resumedChunkCount, logData)
                            }
                        }

                        if (newChunk.content) {
                            totalContentReceived += newChunk.content.length
                            commentText += newChunk.content
                            // Use batched updates for resumed stream chunks too
                            await scheduleUpdate({ commentText }, false)
                            if (ENABLE_DETAILED_LOGGING) {
                                console.log('🔧 NATIVE TOOL CALL: Scheduled comment update with new content', {
                                    iteration: toolCallIteration,
                                    chunkNumber: resumedChunkCount,
                                    addedContentLength: newChunk.content.length,
                                    totalContentReceived,
                                    currentCommentLength: commentText.length,
                                })
                            }
                        }
                    }

                    // Flush any pending updates from resumed stream
                    await flushPendingUpdate()

                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Finished processing resumed stream', {
                            iteration: toolCallIteration,
                            totalResumedChunks: resumedChunkCount,
                            totalContentReceived,
                            finalCommentLength: commentText.length,
                            finalCommentPreview: commentText.substring(0, 500),
                            hasNextToolCalls: !!nextToolCalls,
                            nextToolCallsCount: nextToolCalls?.length || 0,
                        })
                    }

                    // Check if we need to execute more tool calls
                    if (nextToolCalls && nextToolCalls.length > 0) {
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Continuing to next iteration with new tool calls', {
                                nextIteration: toolCallIteration + 1,
                                toolCallsCount: nextToolCalls.length,
                            })
                        }
                        currentToolCalls = nextToolCalls
                        // Continue the while loop
                    } else {
                        // No more tool calls, we're done
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: No more tool calls, exiting loop', {
                                totalIterations: toolCallIteration,
                            })
                        }
                        currentToolCalls = null
                        // Exit the while loop
                    }
                } // End of while loop

                // Check if we hit max iterations
                if (toolCallIteration >= MAX_TOOL_ITERATIONS) {
                    await flushPendingUpdate() // Flush any pending updates first
                    console.warn('🔧 NATIVE TOOL CALL: Hit max tool call iterations!', {
                        maxIterations: MAX_TOOL_ITERATIONS,
                    })
                    commentText += '\n\n⚠️ Maximum tool call iterations reached'
                    await commentRef.update({ commentText, isLoading: false })
                }

                toolAlreadyExecuted = true // Mark as done
                break // Exit the main loop since we've processed everything
            }

            // Handle loading indicator for deep research (immediate update for critical states)
            if (chunk.isLoading) {
                await flushPendingUpdate() // Flush any pending updates first
                commentText = chunk.content
                await commentRef.update({
                    commentText: chunk.content,
                    isLoading: true,
                    isThinking: false,
                })
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('Updated comment with loading state')
                }
                continue
            }

            // If we receive a signal to clear thinking and replace with answer content (immediate update)
            if (chunk.clearThinkingMode && chunk.replacementContent) {
                await flushPendingUpdate() // Flush any pending updates first
                thinkingMode = false
                // Replace the entire comment text with the answer content
                commentText = chunk.replacementContent
                answerContent = chunk.replacementContent

                await commentRef.update({
                    commentText,
                    isThinking: false,
                    isLoading: false,
                })
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('Cleared thinking mode and updated with replacement content:', {
                        contentLength: commentText.length,
                    })
                }
                continue
            }

            // Track if this chunk is part of thinking mode
            if (chunk.isThinking !== undefined) {
                thinkingMode = chunk.isThinking
            }

            // Add the content to our accumulated text
            const contentToAdd = parser ? parser(chunk.content) : chunk.content
            if (ENABLE_DETAILED_LOGGING) {
                console.log('Content to add:', {
                    originalLength: chunk.content?.length,
                    parsedLength: contentToAdd?.length,
                    isThinkingMode: thinkingMode,
                })
            }

            // If in thinking mode, accumulate thinking content separately
            if (thinkingMode) {
                thinkingContent += contentToAdd
                commentText = thinkingContent
            } else {
                // If not in thinking mode, accumulate answer content
                answerContent += contentToAdd
                commentText = answerContent
            }

            // Batch update: schedule update instead of immediate write
            chunksSinceLastUpdate++
            const shouldFlushImmediately = chunksSinceLastUpdate >= BATCH_UPDATE_CHUNK_THRESHOLD

            if (shouldFlushImmediately) {
                chunksSinceLastUpdate = 0
                await flushPendingUpdate()
            }

            scheduleUpdate(
                {
                    commentText,
                    isThinking: thinkingMode,
                    isLoading: false,
                },
                shouldFlushImmediately
            )

            if (ENABLE_DETAILED_LOGGING) {
                console.log('Scheduled comment update:', {
                    commentLength: commentText.length,
                    isThinking: thinkingMode,
                    chunksSinceLastUpdate,
                    willFlushImmediately: shouldFlushImmediately,
                })
            }

            // Note: Manual TOOL: format parsing removed - native tool calling only
            // Tools are only available for GPT models that support native tool calling
        }

        // Flush any pending updates before final operations
        await flushPendingUpdate()

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Finished processing stream chunks:', {
                totalChunks: chunkCount,
                finalCommentLength: commentText.length,
            })
        }

        // Simple validation: warn if assistant mentioned actions without tool calls
        validateToolCallConsistency(commentText)

        const lastComment = cleanTextMetaData(removeFormatTagsFromText(commentText), true)
        if (ENABLE_DETAILED_LOGGING) {
            console.log('Generated last comment:', {
                hasLastComment: !!lastComment,
                lastCommentLength: lastComment?.length,
                originalLength: commentText.length,
            })
        }

        promises = []

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Updating last assistant comment data...')
        }
        promises.push(updateLastAssistantCommentData(projectId, objectType, objectId, currentFollowerIds, assistantId))

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Generating notifications...')
        }
        promises.push(
            generateNotifications(
                projectId,
                objectType,
                objectId,
                userIdsToNotify,
                objectName,
                assistantName,
                projectname,
                chatLink,
                commentId,
                lastComment,
                currentFollowerIds,
                assistantId,
                requestUserId
            )
        )

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Updating chat object...')
            console.log('KW SPECIAL Chat update data:', {
                objectId,
                projectId,
                assistantId,
                userIdsToNotify,
                members: [userIdsToNotify[0], assistantId],
                path: `chatObjects/${projectId}/chats/${objectId}`,
            })
        }
        promises.push(
            admin
                .firestore()
                .doc(`chatObjects/${projectId}/chats/${objectId}`)
                .update({
                    members: [userIdsToNotify[0], assistantId], // Ensure user is first, then assistant
                    lastEditionDate: Date.now(),
                    [`commentsData.lastCommentOwnerId`]: assistantId,
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: STAYWARD_COMMENT,
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1), // Fixed: increment counter instead of resetting to 1
                })
        )

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Updating last comment data...')
        }
        promises.push(
            updateLastCommentDataOfChatParentObject(projectId, objectId, objectType, commentText, STAYWARD_COMMENT)
        )

        // Final operations
        const finalOpsStart = Date.now()
        console.log('🔨 [TIMING] Starting final operations...')
        await Promise.all(promises)
        const finalOpsDuration = Date.now() - finalOpsStart

        const streamProcessDuration = Date.now() - streamProcessStart
        const totalDuration = Date.now() - chunksStartTime

        console.log('🔄 [TIMING] storeChunks COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                initialSetup: `${step1Duration}ms`,
                streamProcessing: `${streamProcessDuration}ms`,
                timeToFirstChunk: firstChunkTime ? `${firstChunkTime - streamProcessStart}ms` : 'N/A',
                finalOperations: `${finalOpsDuration}ms`,
            },
            stats: {
                totalChunks: chunkCount,
                commentLength: commentText.length,
            },
        })

        return commentText
    } catch (error) {
        console.error('❌ [TIMING] Error in storeChunks:', {
            error: error.message,
            duration: `${Date.now() - chunksStartTime}ms`,
            chunksProcessed: chunkCount,
        })
        throw error
    }
}

const getLinkedParentChatUrl = (projectId, objectType, objectId) => {
    const origin = inProductionEnvironment() ? 'https://my.alldone.app' : 'https://mystaging.alldone.app'
    return `${origin}/projects/${projectId}/${objectType === 'topics' ? 'chats' : objectType}/${objectId}/chat`
}

async function getCommonData(projectId, objectType, objectId) {
    const promises = []
    promises.push(getProject(projectId, admin))
    promises.push(getChat(projectId, objectId))
    const [project, chat] = await Promise.all(promises)

    const chatLink = getLinkedParentChatUrl(projectId, objectType, objectId)

    return { project, chat, chatLink }
}

// Global variable to track function start time for time-to-first-token calculation
let globalFunctionStartTime = null

async function storeBotAnswerStream(
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
    userContext = null,
    conversationHistory = null,
    modelKey = null,
    temperatureKey = null,
    allowedTools = [],
    commonData = null, // Optional pre-fetched common data to reduce time-to-first-token
    functionStartTime = null // Optional function start time for time-to-first-token tracking
) {
    const streamProcessStart = Date.now()
    // Store function start time globally for time-to-first-token tracking
    if (functionStartTime) {
        globalFunctionStartTime = functionStartTime
    }

    console.log('💾 [TIMING] storeBotAnswerStream START', {
        timestamp: new Date().toISOString(),
        projectId,
        objectType,
        objectId,
        assistantId,
        hasStream: !!stream,
        hasPreFetchedCommonData: !!commonData,
        functionStartTime: functionStartTime || globalFunctionStartTime,
    })

    try {
        // Fetch common data (or use pre-fetched data)
        const commonDataStart = Date.now()
        const { project, chat, chatLink } = commonData || (await getCommonData(projectId, objectType, objectId))
        const commonDataDuration = Date.now() - commonDataStart

        console.log(`📊 [TIMING] Common data fetch: ${commonDataDuration}ms`, {
            hasProject: !!project,
            hasChat: !!chat,
            hasChatLink: !!chatLink,
            wasPreFetched: !!commonData,
        })

        // Store chunks
        const storeChunksStart = Date.now()
        const result = chat
            ? await storeChunks(
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
            : ''
        const storeChunksDuration = Date.now() - storeChunksStart

        const totalDuration = Date.now() - streamProcessStart
        console.log('💾 [TIMING] storeBotAnswerStream COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                commonDataFetch: `${commonDataDuration}ms`,
                storeChunks: `${storeChunksDuration}ms`,
            },
            hasText: !!result,
            textLength: result?.length,
        })

        return result
    } catch (error) {
        console.error('❌ [TIMING] Error in storeBotAnswerStream:', {
            error: error.message,
            duration: `${Date.now() - streamProcessStart}ms`,
        })
        throw error
    }
}

function replaceUserNameByMention(userName, userId, text) {
    const paresdName = `@${userName.replace(/ /g, MENTION_SPACE_CODE)}#${userId} `
    const re = new RegExp(`${userName}`, 'gi')
    return text.replace(re, paresdName)
}

function addSpaceToUrl(url, text) {
    const re = new RegExp(`${url}`, 'gi')
    return text.replace(re, ` ${url} `)
}

// Cache for assistant data (5 minute TTL)
const assistantCache = new Map()
const ASSISTANT_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const ASSISTANT_ONLY_CACHE_PREFIX = '__assistant__'

const getAssistantProjectCacheKey = (projectId, assistantId) => `${projectId}_${assistantId}`
const getAssistantOnlyCacheKey = assistantId => `${ASSISTANT_ONLY_CACHE_PREFIX}_${assistantId}`

const primeDefaultAssistantCache = async () => {
    if (typeof getDefaultAssistantData !== 'function') {
        return
    }
    try {
        const defaultAssistant = await getDefaultAssistantData(admin)
        if (defaultAssistant?.uid) {
            const normalizedAssistant = {
                ...defaultAssistant,
                model: normalizeModelKey(defaultAssistant.model || 'MODEL_GPT5_1'),
                temperature: defaultAssistant.temperature || 'TEMPERATURE_NORMAL',
                instructions: defaultAssistant.instructions || 'You are a helpful assistant.',
                allowedTools: Array.isArray(defaultAssistant.allowedTools) ? defaultAssistant.allowedTools : [],
            }
            assistantCache.set(getAssistantOnlyCacheKey(defaultAssistant.uid), {
                data: normalizedAssistant,
                timestamp: Date.now(),
            })
        }
    } catch (error) {
        console.log('⚙️ ASSISTANT SETTINGS: Unable to warm assistant cache', {
            error: error.message,
        })
    }
}

primeDefaultAssistantCache()

async function getAssistantForChat(projectId, assistantId, userId = null) {
    const fetchStart = Date.now()
    const now = Date.now()
    const cacheKey = getAssistantProjectCacheKey(projectId, assistantId)

    // Check cache first
    let cached = assistantCache.get(cacheKey)
    if (cached && now - cached.timestamp < ASSISTANT_CACHE_TTL) {
        console.log('⚙️ ASSISTANT SETTINGS: Using cached assistant data', {
            cacheHit: true,
            duration: `${Date.now() - fetchStart}ms`,
            cacheSource: 'project',
        })
        return cached.data
    }

    // Fallback to assistant-only cache entry
    if (!cached) {
        const assistantOnlyKey = getAssistantOnlyCacheKey(assistantId)
        const assistantOnlyCached = assistantCache.get(assistantOnlyKey)
        if (assistantOnlyCached && now - assistantOnlyCached.timestamp < ASSISTANT_CACHE_TTL) {
            assistantCache.set(cacheKey, assistantOnlyCached)
            console.log('⚙️ ASSISTANT SETTINGS: Using cached assistant data', {
                cacheHit: true,
                duration: `${Date.now() - fetchStart}ms`,
                cacheSource: 'assistant_only',
            })
            return assistantOnlyCached.data
        }
    }

    let assistant = null
    if (assistantId) {
        const db = admin.firestore()
        const parallelStart = Date.now()
        const [globalDoc, projectDoc] = await db.getAll(
            db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`),
            db.doc(`assistants/${projectId}/items/${assistantId}`)
        )
        const parallelDuration = Date.now() - parallelStart
        const globalAssistant = globalDoc?.exists ? { ...globalDoc.data(), uid: globalDoc.id } : null
        const projectAssistant = projectDoc?.exists ? { ...projectDoc.data(), uid: projectDoc.id } : null
        assistant = globalAssistant || projectAssistant
        console.log('⚙️ ASSISTANT SETTINGS: Fetched assistant data (batched)', {
            cacheHit: false,
            parallelDuration: `${parallelDuration}ms`,
            foundInGlobal: !!globalAssistant,
            foundInProject: !!projectAssistant,
        })

        // If not found, check user's default project (for cross-project assistant use)
        if (!assistant && userId) {
            const userDoc = await db.doc(`users/${userId}`).get()
            const defaultProjectId = userDoc.exists ? userDoc.data().defaultProjectId : null
            if (defaultProjectId && defaultProjectId !== projectId) {
                const defaultProjectDoc = await db.doc(`assistants/${defaultProjectId}/items/${assistantId}`).get()
                if (defaultProjectDoc.exists) {
                    assistant = { ...defaultProjectDoc.data(), uid: defaultProjectDoc.id }
                    console.log('⚙️ ASSISTANT SETTINGS: Found assistant in user default project', {
                        defaultProjectId,
                        assistantId,
                    })
                }
            }
        }
    }
    if (!assistant) {
        const defaultStart = Date.now()
        assistant = await getDefaultAssistantData(admin)
        console.log('⚙️ ASSISTANT SETTINGS: Fetched default assistant', {
            duration: `${Date.now() - defaultStart}ms`,
        })
    }
    // Provide fallback defaults for missing fields
    assistant = assistant || {}
    assistant.model = normalizeModelKey(assistant?.model || 'MODEL_GPT5_1')
    assistant.temperature = assistant?.temperature || 'TEMPERATURE_NORMAL'
    assistant.instructions = assistant?.instructions || 'You are a helpful assistant.'
    assistant.allowedTools = Array.isArray(assistant?.allowedTools) ? assistant.allowedTools : []
    assistant.uid = assistant?.uid || assistantId

    // Cache the result
    if (assistant) {
        const cachePayload = { data: assistant, timestamp: now }
        assistantCache.set(cacheKey, cachePayload)
        if (assistant.uid) {
            assistantCache.set(getAssistantOnlyCacheKey(assistant.uid), cachePayload)
        }
        // Clean old cache entries if cache gets too large
        if (assistantCache.size > 100) {
            const oldestKey = assistantCache.keys().next().value
            assistantCache.delete(oldestKey)
        }
    }

    const totalDuration = Date.now() - fetchStart
    console.log('⚙️ ASSISTANT SETTINGS: getAssistantForChat completed', {
        totalDuration: `${totalDuration}ms`,
        cached: !!cached,
    })

    return assistant
}

// New function to get task-level settings or fall back to assistant settings
async function getTaskOrAssistantSettings(projectId, taskId, assistantId) {
    const settingsStart = Date.now()
    console.log('⚙️ ASSISTANT SETTINGS: Getting task or assistant settings:', { projectId, taskId, assistantId })

    // Fetch task data and assistant settings in parallel
    const parallelStart = Date.now()
    const [taskDoc, assistant] = await Promise.all([
        admin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${taskId}`).get(),
        getAssistantForChat(projectId, assistantId),
    ])
    const parallelDuration = Date.now() - parallelStart
    console.log('⚙️ ASSISTANT SETTINGS: Parallel fetch completed', {
        parallelDuration: `${parallelDuration}ms`,
    })

    const task = taskDoc.data()
    console.log('⚙️ ASSISTANT SETTINGS: Task data:', {
        hasTask: !!task,
        taskAiModel: task?.aiModel,
        taskAiTemperature: task?.aiTemperature,
        hasTaskAiSystemMessage: !!task?.aiSystemMessage,
    })
    console.log('⚙️ ASSISTANT SETTINGS: Assistant data:', {
        hasAssistant: !!assistant,
        assistantModel: assistant?.model,
        assistantTemperature: assistant?.temperature,
        hasAssistantInstructions: !!assistant?.instructions,
        assistantDisplayName: assistant?.displayName,
        allowedToolsCount: assistant?.allowedTools?.length || 0,
    })

    // Return task settings if they exist, otherwise use assistant settings with defaults
    const settings = {
        model: normalizeModelKey((task && task.aiModel) || assistant.model || 'MODEL_GPT5_1'),
        temperature: (task && task.aiTemperature) || assistant.temperature || 'TEMPERATURE_NORMAL',
        instructions: (task && task.aiSystemMessage) || assistant.instructions || 'You are a helpful assistant.',
        displayName: assistant.displayName, // Always use assistant's display name
        uid: assistant.uid, // Always use assistant's uid
        allowedTools: Array.isArray(assistant.allowedTools) ? assistant.allowedTools : [],
    }

    console.log('⚙️ ASSISTANT SETTINGS: Final resolved settings:', {
        finalModel: settings.model,
        finalTemperature: settings.temperature,
        hasInstructions: !!settings.instructions,
        displayName: settings.displayName,
        allowedTools: settings.allowedTools,
        modelTokensPerGold: getTokensPerGold(settings.model),
        settingsSource: {
            model: task && task.aiModel ? 'task' : 'assistant',
            temperature: task && task.aiTemperature ? 'task' : 'assistant',
            instructions: task && task.aiSystemMessage ? 'task' : 'assistant',
        },
        totalDuration: `${Date.now() - settingsStart}ms`,
    })
    return settings
}

function addBaseInstructions(messages, name, language, instructions, allowedTools = [], userTimezoneOffset = null) {
    // messages.push(['system', `Your responses must be limited to ${COMPLETION_MAX_TOKENS} tokens.`])
    messages.push(['system', `You are an AI assistant  and your name is: "${parseTextForUseLiKePrompt(name || '')}"`])
    // Prevent AI from summarizing/referencing previous conversation before answering
    messages.push([
        'system',
        "Respond directly to the user's latest message without preamble and do not repeat the timestamp and names of the previous messages which are only given for your context.",
    ])
    // messages.push(['system', `Speak in ${parseTextForUseLiKePrompt(language || 'English')}`])
    messages.push(['system', `Speak in the same language the user speaks`])

    // Generate current date/time in user's timezone if available
    let currentDateTime
    if (userTimezoneOffset !== null && typeof userTimezoneOffset === 'number') {
        // userTimezoneOffset is in minutes
        currentDateTime = moment().utcOffset(userTimezoneOffset)
    } else {
        // Fallback to UTC if no timezone provided
        currentDateTime = moment().utc()
    }
    messages.push(['system', `The current date is ${currentDateTime.format('dddd, MMMM Do YYYY, h:mm:ss a')}`])

    // Add emphasis on immediate action for tool-enabled assistants
    if (Array.isArray(allowedTools) && allowedTools.length > 0) {
        messages.push([
            'system',
            `IMPORTANT: You are action-oriented. When users ask you to do something, DO IT IMMEDIATELY - don't just talk about doing it.`,
        ])
    }
    messages.push([
        'system',
        'Always left a space between links and words. Do not wrap links inside [],{{}},() or any other characters',
    ])
    // Note: Tool instructions removed - using OpenAI native tool calling instead of manual TOOL: format
    if (instructions) messages.push(['system', parseTextForUseLiKePrompt(instructions)])
}

function parseTextForUseLiKePrompt(text) {
    if (!text) return ''
    return text.replaceAll('{', '{{').replaceAll('}', '}}')
}

// Optimized context fetching with parallel operations
async function getOptimizedContextMessages(
    messageId,
    projectId,
    objectType,
    objectId,
    language,
    assistantName,
    instructions,
    allowedTools,
    userTimezoneOffset,
    userId
) {
    // Start all operations in parallel
    const parallelPromises = [
        // Fetch messages
        admin
            .firestore()
            .collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`)
            .orderBy('lastChangeDate', 'desc')
            .limit(10) // Reduced from 50 to improve speed
            .get()
            .then(snapshot => snapshot.docs),
        // Fetch chat/object data to get the topic name
        getChat(projectId, objectId).catch(() => null),
    ]

    // If we need notes context, fetch the specific message in parallel
    if (userId && messageId) {
        parallelPromises.push(
            admin
                .firestore()
                .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${messageId}`)
                .get()
                .then(async doc => {
                    if (!doc.exists) return null
                    const commentText = doc.data().commentText
                    const { fetchMentionedNotesContext } = require('./noteContextHelper')
                    return await fetchMentionedNotesContext(commentText, userId, projectId)
                })
                .catch(() => null)
        )
    } else {
        parallelPromises.push(Promise.resolve(null))
    }

    const [commentDocs, chatData, notesContext] = await Promise.all(parallelPromises)

    // Collect messages from conversation history
    const messages = []
    let amountOfCommentsInContext = 0

    for (let i = 0; i < commentDocs.length; i++) {
        if (amountOfCommentsInContext > 0 || messageId === commentDocs[i].id) {
            const messageData = commentDocs[i].data()
            const { commentText, fromAssistant } = messageData

            if (commentText) {
                const role = fromAssistant ? 'assistant' : 'user'
                messages.push([role, parseTextForUseLiKePrompt(commentText)])
            }
            amountOfCommentsInContext++
            if (amountOfCommentsInContext === 5) break
        }
    }

    // Add base instructions
    addBaseInstructions(messages, assistantName, language, instructions, allowedTools, userTimezoneOffset)

    // Add topic/context information if available
    if (chatData && chatData.title) {
        const objectTypeLabel = objectType === 'topics' ? 'chat' : objectType.replace(/s$/, '') // tasks -> task, notes -> note
        messages.push([
            'system',
            `This conversation is about a ${objectTypeLabel} titled: "${parseTextForUseLiKePrompt(chatData.title)}"`,
        ])
    }

    const reversedMessages = messages.reverse()

    // Add notes context if available
    if (notesContext && reversedMessages.length > 0) {
        const lastMessageIndex = reversedMessages.length - 1
        if (reversedMessages[lastMessageIndex][0] === 'user') {
            reversedMessages[lastMessageIndex][1] += notesContext
        }
    }

    return reversedMessages
}

/**
 * Example function showing how internal assistants can use SearchService
 * This function can be called by AI assistants to search for relevant content
 * when answering user questions or performing tasks.
 */
async function searchForAssistant(userId, projectId, query, options = {}) {
    const { type = 'all', dateRange = null, includeContent = false } = options

    try {
        // Initialize SearchService
        const { SearchService } = require('../shared/SearchService')
        const searchService = new SearchService({
            database: admin.firestore(),
            moment: moment,
            enableAlgolia: true,
            enableNoteContent: true,
            enableDateParsing: true,
            isCloudFunction: true,
        })
        await searchService.initialize()

        // Execute search
        const searchResults = await searchService.search(userId, {
            query,
            type,
            projectId,
            dateRange,
        })

        // If includeContent is true, fetch full note content for note results
        if (includeContent && searchResults.results.notes) {
            for (const noteResult of searchResults.results.notes) {
                try {
                    const fullNote = await searchService.getNote(userId, noteResult.id, noteResult.projectId)
                    noteResult.fullContent = fullNote.content
                    noteResult.wordCount = fullNote.metadata.wordCount
                } catch (error) {
                    console.warn(`Could not fetch full content for note ${noteResult.id}:`, error.message)
                }
            }
        }

        return {
            success: true,
            query: searchResults.query,
            parsedQuery: searchResults.parsedQuery,
            results: searchResults.results,
            totalResults: searchResults.totalResults,
            summary: generateSearchSummary(searchResults),
        }
    } catch (error) {
        console.error('Assistant search failed:', error)
        return {
            success: false,
            error: error.message,
            results: {},
            totalResults: 0,
        }
    }
}

/**
 * Generate a human-readable summary of search results for assistants
 */
function generateSearchSummary(searchResults) {
    const { results, totalResults, query } = searchResults
    const summaryParts = []

    if (totalResults === 0) {
        return `No results found for "${query}"`
    }

    Object.entries(results).forEach(([type, items]) => {
        if (items && items.length > 0) {
            const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
            summaryParts.push(`${items.length} ${typeLabel.toLowerCase()}`)
        }
    })

    const summary = `Found ${totalResults} results for "${query}": ${summaryParts.join(', ')}`

    // Add context about most relevant results
    const allResults = Object.values(results)
        .flat()
        .sort((a, b) => b.score - a.score)
    if (allResults.length > 0) {
        const topResult = allResults[0]
        return `${summary}. Most relevant: ${topResult.title} (${topResult.type})`
    }

    return summary
}

/**
 * Simple validation to log when assistant mentions actions without tool calls
 * This helps with debugging and monitoring
 */
function validateToolCallConsistency(commentText) {
    try {
        // Check if the assistant mentioned actions without actually calling tools
        const mentionedActions = []
        const intentPatterns = [
            /(?:I will|I'll|let me|I'm going to)\s+(create|make|add|update|get|retrieve|find)\s+(?:a\s+)?(task|note|tasks)/gi,
            /(?:creating|making|adding|updating|getting|retrieving|finding)\s+(?:a\s+)?(task|note|tasks)/gi,
        ]

        intentPatterns.forEach(pattern => {
            const matches = commentText.matchAll(pattern)
            for (const match of matches) {
                mentionedActions.push(match[0])
            }
        })

        // Check if there are already tool calls in the text
        const hasToolCalls = /TOOL:\s*\w+\s*\{/.test(commentText)

        if (mentionedActions.length > 0 && !hasToolCalls) {
            console.warn('🔍 TOOL VALIDATION: Assistant mentioned actions without tool calls:', {
                mentionedActions,
                commentText: commentText.substring(0, 200) + '...',
            })
        } else if (mentionedActions.length > 0 && hasToolCalls) {
            console.log('🔍 TOOL VALIDATION: Assistant mentioned actions with tool calls - OK')
        }
    } catch (error) {
        console.error('🔍 TOOL VALIDATION: Error in validation:', error)
    }
}

/**
 * Process tool results through LLM for intelligent analysis and formatting
 */
// processToolResultWithLLM function removed - native tool calling only

module.exports = {
    COMPLETION_MAX_TOKENS,
    storeBotAnswerStream,
    replaceUserNameByMention,
    addSpaceToUrl,
    interactWithChatStream,
    getAssistantForChat,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
    ENCODE_MESSAGE_GAP,
    reduceGoldWhenChatWithAI,
    getTaskOrAssistantSettings,
    searchForAssistant,
    generateSearchSummary,
    getCommonData, // Export for parallel fetching to reduce time-to-first-token
    normalizeModelKey, // Export for model normalization and backward compatibility
    // Optimized functions with caching
    getCachedEnvFunctions,
    getOpenAIClient,
    getOptimizedContextMessages,
    getMaxTokensForModel,
}
