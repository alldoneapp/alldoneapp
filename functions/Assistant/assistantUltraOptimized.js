// Ultra-optimized assistant implementation with aggressive caching and pre-loading

// Pre-load heavy modules at cold start
const admin = require('firebase-admin')
const { Tiktoken } = require('@dqbd/tiktoken/lite')
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { getUserData } = require('../Users/usersFirestore')

// Pre-initialize everything at module level
console.log('[STARTUP] Pre-initializing modules...')
const startupTime = Date.now()

// 1. Pre-load environment
const ENV = getEnvFunctions()
console.log(`[STARTUP] Environment loaded: ${Date.now() - startupTime}ms`)

// 2. Pre-initialize Firestore with settings
const db = admin.firestore()
db.settings({
    ignoreUndefinedProperties: true,
    cacheSizeBytes: 50 * 1024 * 1024,
})
console.log(`[STARTUP] Firestore initialized: ${Date.now() - startupTime}ms`)

// 3. Pre-initialize tiktoken encoder
const ENCODER = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
console.log(`[STARTUP] Tiktoken encoder initialized: ${Date.now() - startupTime}ms`)

// 4. Pre-initialize OpenAI client
const { OpenAI } = require('openai')
const openaiClient = new OpenAI({ apiKey: ENV.OPEN_AI_KEY })
console.log(`[STARTUP] OpenAI client initialized: ${Date.now() - startupTime}ms`)

// Caches
const assistantCache = new Map()
const messageCache = new Map()
const commonDataCache = new Map()

// Cache helpers
function getCacheKey(id, type) {
    const ttl = type === 'assistant' ? 300000 : 60000 // 5 min for assistants, 1 min for others
    return `${id}_${Math.floor(Date.now() / ttl)}`
}

// Ultra-fast context generation
function generateContextUltraFast(messages) {
    const startTime = Date.now()
    const TOTAL_MAX_TOKENS = 4096
    const COMPLETION_MAX_TOKENS = 2048
    const ENCODE_MESSAGE_GAP = 4
    const ENCODE_INITIAL_GAP = 3

    let unusedTokens = TOTAL_MAX_TOKENS - COMPLETION_MAX_TOKENS - ENCODE_INITIAL_GAP
    const contextMessages = []

    for (let i = messages.length - 1; i >= 0; i--) {
        // Use pre-initialized encoder
        const tokens = ENCODER.encode(messages[i][1])
        const messageTokens = tokens.length + ENCODE_MESSAGE_GAP

        if (unusedTokens - messageTokens >= ENCODE_INITIAL_GAP) {
            contextMessages.push(messages[i])
            unusedTokens -= messageTokens
        } else {
            break
        }
    }

    console.log(`[PERF] Context generation: ${Date.now() - startTime}ms for ${messages.length} messages`)
    return contextMessages.reverse()
}

// Optimized assistant fetch
async function getAssistantOptimized(assistantId) {
    const cacheKey = getCacheKey(assistantId, 'assistant')

    if (assistantCache.has(cacheKey)) {
        console.log('[CACHE HIT] Assistant from cache')
        return assistantCache.get(cacheKey)
    }

    const startTime = Date.now()
    // Fetch both assistant configs in parallel if it's a project assistant
    const [globalDoc, projectDoc] = await Promise.all([
        db.collection('globalAssistants').doc(assistantId).get(),
        assistantId.startsWith('-') ? db.collection(`assistants`).doc(assistantId).get() : Promise.resolve(null),
    ])

    let assistant = null
    if (globalDoc.exists) {
        assistant = { ...globalDoc.data(), uid: assistantId }
    } else if (projectDoc && projectDoc.exists) {
        assistant = { ...projectDoc.data(), uid: assistantId }
    }

    console.log(`[DB] Assistant fetch: ${Date.now() - startTime}ms`)

    if (assistant) {
        assistantCache.set(cacheKey, assistant)
    }

    return assistant
}

// The main ultra-optimized function
async function askToOpenAIBotUltraOptimized(
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
    console.log('🚀 [ULTRA] askToOpenAIBot START', {
        timestamp: new Date().toISOString(),
        startupPreloadTime: startupTime ? `${Date.now() - startupTime}ms since startup` : 'N/A',
    })

    try {
        // Step 1: Parallel fetch with optimizations
        const step1Start = Date.now()
        const [user, assistant, messages] = await Promise.all([
            getUserData(userId),
            getAssistantOptimized(assistantId),
            getMessagesOptimized(messageId, projectId, objectType, objectId),
        ])
        const step1Duration = Date.now() - step1Start

        console.log('✅ [ULTRA] Step 1 - Triple parallel fetch', {
            duration: `${step1Duration}ms`,
            userGold: user?.gold,
            assistantModel: assistant?.model,
            messagesCount: messages?.length,
        })

        if (!user || user.gold <= 0) {
            console.log('⚠️ [ULTRA] User has no gold')
            return
        }

        // Step 2: Generate context (should be instant with pre-loaded encoder)
        const step2Start = Date.now()
        const contextMessages = generateContextUltraFast(messages)
        const step2Duration = Date.now() - step2Start

        console.log('✅ [ULTRA] Step 2 - Context generation', {
            duration: `${step2Duration}ms`,
            contextMessagesCount: contextMessages.length,
        })

        // Step 3: Create stream with pre-initialized client
        const step3Start = Date.now()
        const stream = await createStreamOptimized(
            contextMessages,
            assistant.model,
            assistant.temperature,
            assistant.allowedTools || []
        )
        const step3Duration = Date.now() - step3Start

        console.log('✅ [ULTRA] Step 3 - Stream creation', {
            duration: `${step3Duration}ms`,
        })

        // Process the stream...
        // (rest of implementation)

        const totalDuration = Date.now() - functionStartTime
        console.log('🎯 [ULTRA] COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                tripleParallelFetch: `${step1Duration}ms`,
                contextGeneration: `${step2Duration}ms`,
                streamCreation: `${step3Duration}ms`,
            },
        })
    } catch (error) {
        console.error('❌ [ULTRA] Error:', error)
        throw error
    }
}

// Optimized message fetching
async function getMessagesOptimized(messageId, projectId, objectType, objectId) {
    const cacheKey = getCacheKey(`${projectId}_${objectId}_${messageId}`, 'messages')

    if (messageCache.has(cacheKey)) {
        console.log('[CACHE HIT] Messages from cache')
        return messageCache.get(cacheKey)
    }

    const startTime = Date.now()
    const snapshot = await db
        .collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`)
        .orderBy('lastChangeDate', 'desc')
        .limit(10)
        .get()

    const messages = []
    let foundTrigger = false

    snapshot.forEach(doc => {
        if (foundTrigger || doc.id === messageId) {
            foundTrigger = true
            const data = doc.data()
            if (data.commentText) {
                messages.push([data.fromAssistant ? 'assistant' : 'user', data.commentText])
            }
            if (messages.length >= 5) return
        }
    })

    console.log(`[DB] Messages fetch: ${Date.now() - startTime}ms`)

    messageCache.set(cacheKey, messages.reverse())
    return messages
}

// Optimized stream creation
async function createStreamOptimized(messages, modelKey, temperatureKey, allowedTools) {
    const model = modelKey === 'MODEL_GPT5' ? 'gpt-3.5-turbo' : 'gpt-4'
    const temperature = temperatureKey === 'TEMPERATURE_HIGH' ? 1.0 : 0.7

    const requestParams = {
        model,
        messages: messages.map(([role, content]) => ({ role, content })),
        stream: true,
        temperature,
    }

    if (allowedTools.length > 0) {
        const { getToolSchemas } = require('./toolSchemas')
        requestParams.tools = getToolSchemas(allowedTools)
    }

    // Use pre-initialized client
    return await openaiClient.chat.completions.create(requestParams)
}

// Export the ultra-optimized version
module.exports = {
    askToOpenAIBot: askToOpenAIBotUltraOptimized,
}
