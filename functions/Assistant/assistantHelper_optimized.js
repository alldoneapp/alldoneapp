// Optimized assistant helper functions to reduce latency

const { getEnvFunctions } = require('../envFunctionsHelper')

// Cache environment variables at module level
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

// Cache OpenAI clients
const openAIClients = new Map()

function getOpenAIClient(apiKey) {
    if (!openAIClients.has(apiKey)) {
        const { OpenAI } = require('openai')
        openAIClients.set(apiKey, new OpenAI({ apiKey }))
    }
    return openAIClients.get(apiKey)
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
    const admin = require('firebase-admin')

    // Start all operations in parallel
    const [commentDocs, notesContext] = await Promise.all([
        // Fetch messages
        admin
            .firestore()
            .collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`)
            .orderBy('lastChangeDate', 'desc')
            .limit(10) // Reduced from 50 to improve speed
            .get()
            .then(snapshot => snapshot.docs),

        // Fetch mentioned notes context if needed
        userId && messageId
            ? fetchMentionedNotesContextOptimized(messageId, userId, projectId, commentDocs)
            : Promise.resolve(null),
    ])

    // Process messages
    const messages = []
    let amountOfCommentsInContext = 0

    for (let i = 0; i < commentDocs.length; i++) {
        if (amountOfCommentsInContext > 0 || messageId === commentDocs[i].id) {
            const messageData = commentDocs[i].data()
            const { commentText, fromAssistant } = messageData
            if (commentText) {
                const role = fromAssistant ? 'assistant' : 'user'
                messages.push([role, commentText])
            }
            amountOfCommentsInContext++
            if (amountOfCommentsInContext === 5) break // Reduced from 3 to 5 for better context
        }
    }

    // Add base instructions
    addBaseInstructions(messages, assistantName, language, instructions, allowedTools, userTimezoneOffset)

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

async function fetchMentionedNotesContextOptimized(messageId, userId, projectId, commentDocs) {
    try {
        // This would be optimized in production
        const { fetchMentionedNotesContext } = require('./noteContextHelper')

        // Find message in already fetched docs
        const currentMessageDoc = commentDocs?.find(doc => doc.id === messageId)
        if (!currentMessageDoc) return null

        const commentText = currentMessageDoc.data().commentText
        return await fetchMentionedNotesContext(commentText, userId, projectId)
    } catch (error) {
        console.error('Error fetching notes context:', error)
        return null
    }
}

// Optimized streaming function with connection pooling
async function interactWithChatStreamOptimized(formattedPrompt, modelKey, temperatureKey, allowedTools = []) {
    console.log('Starting optimized chat stream...')

    const model = getModel(modelKey)
    const temperature = getTemperature(temperatureKey)
    const envFunctions = getCachedEnvFunctions() // Use cached version

    const { OPEN_AI_KEY, PERPLEXITY_API_KEY } = envFunctions

    if (modelKey.startsWith('MODEL_SONAR')) {
        // Perplexity model handling
        const { PerplexityClient } = require('./perplexityClient')
        const client = new PerplexityClient(PERPLEXITY_API_KEY, model)
        return client.stream(formattedPrompt)
    } else {
        // Use cached OpenAI client
        const openai = getOpenAIClient(OPEN_AI_KEY)

        // Convert messages to OpenAI format
        const messages = Array.isArray(formattedPrompt)
            ? formattedPrompt.map(msg => {
                  if (Array.isArray(msg)) {
                      return { role: msg[0], content: msg[1] }
                  }
                  if (typeof msg === 'object' && msg.role) {
                      const result = { role: msg.role, content: msg.content || '' }
                      if (msg.tool_calls) result.tool_calls = msg.tool_calls
                      if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id
                      return result
                  }
                  throw new Error('Unexpected message format')
              })
            : formattedPrompt

        const requestParams = {
            model: model,
            messages: messages,
            stream: true,
        }

        if (modelSupportsCustomTemperature(modelKey)) {
            requestParams.temperature = temperature
        }

        if (modelSupportsNativeTools(modelKey) && allowedTools.length > 0) {
            const { getToolSchemas } = require('./toolSchemas')
            requestParams.tools = getToolSchemas(allowedTools)
            requestParams.tool_choice = 'auto'
        }

        const stream = await openai.chat.completions.create(requestParams)
        return convertOpenAIStream(stream)
    }
}

// Helper functions that would need to be imported
function getModel(modelKey) {
    const modelMap = {
        MODEL_GPT_3_5_TURBO: 'gpt-3.5-turbo',
        MODEL_GPT_4: 'gpt-4',
        MODEL_GPT_4_TURBO: 'gpt-4-turbo-preview',
        MODEL_GPT_4_O: 'gpt-4o',
        MODEL_GPT_4_O_MINI: 'gpt-4o-mini',
    }
    return modelMap[modelKey] || 'gpt-3.5-turbo'
}

function getTemperature(temperatureKey) {
    const tempMap = {
        TEMPERATURE_NONE: 0,
        TEMPERATURE_LOW: 0.3,
        TEMPERATURE_MEDIUM: 0.7,
        TEMPERATURE_HIGH: 1.0,
    }
    return tempMap[temperatureKey] || 0.7
}

function modelSupportsCustomTemperature(modelKey) {
    return !modelKey.startsWith('MODEL_GPT_5')
}

function modelSupportsNativeTools(modelKey) {
    return modelKey.startsWith('MODEL_GPT')
}

async function* convertOpenAIStream(stream) {
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        const finishReason = chunk.choices[0]?.finish_reason

        if (!delta && !finishReason) continue

        yield {
            content: delta?.content || '',
            additional_kwargs: {
                tool_calls: delta?.tool_calls || null,
            },
            finish_reason: finishReason,
        }
    }
}

function addBaseInstructions(messages, name, language, instructions, allowedTools = [], userTimezoneOffset = null) {
    const moment = require('moment')

    messages.push(['system', `You are an AI assistant and your name is: "${name || ''}"`])
    messages.push(['system', `Speak in the same language the user speaks')}`])

    let currentDateTime
    if (userTimezoneOffset !== null && typeof userTimezoneOffset === 'number') {
        currentDateTime = moment().utcOffset(userTimezoneOffset)
    } else {
        currentDateTime = moment().utc()
    }
    messages.push(['system', `The current date is ${currentDateTime.format('dddd, MMMM Do YYYY, h:mm:ss a')}`])

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

    if (instructions) messages.push(['system', instructions])
}

module.exports = {
    getCachedEnvFunctions,
    getOpenAIClient,
    getOptimizedContextMessages,
    interactWithChatStreamOptimized,
    addBaseInstructions,
    getModel,
    getTemperature,
    modelSupportsCustomTemperature,
    modelSupportsNativeTools,
    convertOpenAIStream,
}
