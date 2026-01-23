const admin = require('firebase-admin')
const {
    interactWithChatStream,
    getAssistantForChat,
    addBaseInstructions,
    reduceGoldWhenChatWithAI,
    executeToolNatively,
} = require('../Assistant/assistantHelper')
const { getUserData } = require('../Users/usersFirestore')
const { getConversationHistory, storeAssistantMessageInTopic } = require('./whatsAppDailyTopic')

const MAX_TOOL_ITERATIONS = 10
const MAX_WHATSAPP_RESPONSE_LENGTH = 4000

/**
 * Process a WhatsApp message through the AI assistant pipeline.
 * Collects the full response (non-streaming) since WhatsApp messages are sent whole.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} chatId - The daily topic chat ID
 * @param {string} messageText - The user's message
 * @param {string} assistantId
 * @returns {Promise<string>} The AI response text
 */
async function processWhatsAppAssistantMessage(userId, projectId, chatId, messageText, assistantId) {
    // Fetch user data and assistant config in parallel
    const [user, assistant] = await Promise.all([
        getUserData(userId),
        getAssistantForChat(projectId, assistantId, userId),
    ])

    if (!user || user.gold <= 0) {
        return 'Sorry, you have run out of credits. Please check your account in the Alldone app.'
    }

    const { model, temperature, instructions, displayName, allowedTools: rawTools } = assistant
    const allowedTools = Array.isArray(rawTools) ? rawTools : []

    // Extract user timezone
    const userTimezoneOffset =
        user.timezone ?? user.timezoneOffset ?? user.timezoneMinutes ?? user.preferredTimezone ?? null

    // Fetch conversation history from the daily topic
    const history = await getConversationHistory(projectId, chatId, 10)

    // Build messages array
    const messages = []
    addBaseInstructions(messages, displayName, user.language, instructions, allowedTools, userTimezoneOffset)

    // Add WhatsApp-specific instruction
    messages.push([
        'system',
        'IMPORTANT - WhatsApp context rules (these override any previous instructions about being action-oriented):\n' +
            '- Keep responses concise (under 1000 characters when possible).\n' +
            '- Use *bold* and _italic_ for emphasis (WhatsApp formatting).\n' +
            '- Do not use markdown headers (#), code blocks (```), or tables.\n' +
            '- Use simple bullet points with - for lists.\n' +
            '- CRITICAL: Do NOT call any tools unless the user EXPLICITLY and CLEARLY asks you to perform a specific action like "create a task called X" or "search for Y". ' +
            'Messages like "hello", "hi", "how are you", "thanks", or any casual conversation must NEVER trigger tool calls. ' +
            'When in doubt, just respond with text - do not use tools.',
    ])

    // Add conversation history
    history.forEach(([role, content]) => {
        messages.push([role, content])
    })

    // Add the current user message
    messages.push(['user', messageText])

    // Call the AI
    const stream = await interactWithChatStream(messages, model, temperature, allowedTools)

    // Collect the full response, handling tool calls
    const responseText = await collectStreamWithToolCalls(
        stream,
        messages,
        model,
        temperature,
        allowedTools,
        projectId,
        assistantId,
        userId
    )

    // Store AI response in topic and update lastAssistantCommentData for AssistantLine
    await storeAssistantMessageInTopic(projectId, chatId, assistant.uid || assistantId, responseText, userId)

    // Deduct gold
    try {
        const { Tiktoken } = require('@dqbd/tiktoken/lite')
        const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')
        const encoder = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
        await reduceGoldWhenChatWithAI(userId, user.gold, model, responseText, messages, encoder)
        encoder.free()
    } catch (error) {
        console.error('WhatsApp: Error deducting gold:', error.message)
    }

    // Truncate if too long for WhatsApp
    if (responseText.length > MAX_WHATSAPP_RESPONSE_LENGTH) {
        return responseText.substring(0, MAX_WHATSAPP_RESPONSE_LENGTH) + '...'
    }

    return responseText
}

/**
 * Collect a complete response from an AI stream, handling tool calls.
 * Unlike the in-app version (storeChunks), this doesn't write to Firestore during streaming.
 *
 * @returns {Promise<string>} Complete response text
 */
async function collectStreamWithToolCalls(
    stream,
    conversationHistory,
    modelKey,
    temperatureKey,
    allowedTools,
    projectId,
    assistantId,
    requestUserId
) {
    let responseText = ''
    let currentConversation = conversationHistory

    for await (const chunk of stream) {
        // Handle tool calls
        if (chunk.additional_kwargs?.tool_calls && Array.isArray(chunk.additional_kwargs.tool_calls)) {
            let currentToolCalls = chunk.additional_kwargs.tool_calls
            let toolCallIteration = 0

            while (currentToolCalls && currentToolCalls.length > 0 && toolCallIteration < MAX_TOOL_ITERATIONS) {
                toolCallIteration++

                const toolCall = currentToolCalls[0]
                const toolName = toolCall.function.name
                const toolCallId = toolCall.id

                // Parse arguments
                let toolArgs = {}
                try {
                    toolArgs = JSON.parse(toolCall.function.arguments)
                } catch (e) {
                    console.error('WhatsApp: Failed to parse tool arguments:', e.message)
                    responseText += `\n\nError: Failed to parse tool arguments for ${toolName}`
                    return responseText
                }

                // Check permissions
                const allowed = allowedTools.includes(toolName)
                if (!allowed) {
                    console.warn('WhatsApp: Tool not permitted:', toolName)
                    responseText += `\n\nTool not permitted: ${toolName}`
                    return responseText
                }

                console.log('WhatsApp: Executing tool:', { toolName, toolArgs, iteration: toolCallIteration })

                // Execute tool
                let toolResult
                try {
                    toolResult = await executeToolNatively(toolName, toolArgs, projectId, assistantId, requestUserId, {
                        message: conversationHistory.find(m => m[0] === 'user')?.[1] || '',
                    })
                } catch (error) {
                    console.error('WhatsApp: Tool execution failed:', error.message)
                    responseText += `\n\nError executing ${toolName}: ${error.message}`
                    return responseText
                }

                // Build updated conversation with tool result
                const updatedConversation = [
                    ...currentConversation,
                    {
                        role: 'assistant',
                        content: responseText,
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

                currentConversation = updatedConversation

                // Get new stream with tool results
                const newStream = await interactWithChatStream(
                    updatedConversation,
                    modelKey,
                    temperatureKey,
                    allowedTools
                )

                // Process the resumed stream
                let nextToolCalls = null
                for await (const newChunk of newStream) {
                    if (newChunk.additional_kwargs?.tool_calls) {
                        nextToolCalls = newChunk.additional_kwargs.tool_calls
                    } else if (newChunk.content) {
                        responseText += newChunk.content
                    }
                }

                if (nextToolCalls && nextToolCalls.length > 0) {
                    currentToolCalls = nextToolCalls
                } else {
                    currentToolCalls = null
                }
            }

            if (toolCallIteration >= MAX_TOOL_ITERATIONS) {
                responseText += '\n\nMaximum tool call iterations reached.'
            }

            // Done processing tool calls, exit the main stream loop
            break
        }

        // Regular content chunk
        if (chunk.content) {
            responseText += chunk.content
        }
    }

    return responseText.trim()
}

module.exports = {
    processWhatsAppAssistantMessage,
}
