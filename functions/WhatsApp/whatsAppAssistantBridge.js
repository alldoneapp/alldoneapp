const admin = require('firebase-admin')
const {
    interactWithChatStream,
    getAssistantForChat,
    addBaseInstructions,
    reduceGoldWhenChatWithAI,
    executeToolNatively,
    getMessageTextForTokenCounting,
    isToolAllowedForExecution,
} = require('../Assistant/assistantHelper')
const { getUserData } = require('../Users/usersFirestore')
const { getConversationHistory, storeAssistantMessageInTopic } = require('./whatsAppDailyTopic')

const MAX_TOOL_ITERATIONS = 10
const MAX_WHATSAPP_MESSAGE_LENGTH = 1400
const TASK_CREATION_FAILURE_MESSAGE = 'I could not create that task because of a technical issue. Please try again.'
const GENERIC_TOOL_FAILURE_MESSAGE = 'I could not complete that action because of a technical issue. Please try again.'
const TALK_TO_ASSISTANT_TOOL_KEY = 'talk_to_assistant'
const TALK_TO_ASSISTANT_TOOL_PREFIX = 'talk_to_assistant_'

/**
 * Process a WhatsApp message through the AI assistant pipeline.
 * Collects the full response (non-streaming) since WhatsApp messages are sent whole.
 *
 * @param {string} userId
 * @param {string} projectId
 * @param {string} chatId - The daily topic chat ID
 * @param {string} messageText - The user's message
 * @param {string} assistantId
 * @param {Array|undefined} userMessageContent - Optional multimodal content for current user message
 * @param {Object|undefined} options
 * @param {boolean|undefined} options.skipCurrentMessageAppend - Skip appending current user message when it was already persisted to history
 * @returns {Promise<string>} The AI response text
 */
async function processWhatsAppAssistantMessage(
    userId,
    projectId,
    chatId,
    messageText,
    assistantId,
    userMessageContent,
    options = {}
) {
    const requestStart = Date.now()
    const markStage = createStageTimer('WhatsApp Assistant [TIMING]', {
        userId,
        projectId,
        chatId,
        assistantId,
    })
    const skipCurrentMessageAppend = options?.skipCurrentMessageAppend === true
    // Fetch user data and assistant config in parallel
    const loadRuntimeStart = Date.now()
    const [user, assistant] = await Promise.all([
        getUserData(userId),
        getAssistantForChat(projectId, assistantId, userId, { forceRefresh: true }),
    ])
    markStage('loadUserAndAssistant', loadRuntimeStart, {
        hasUser: !!user,
        resolvedAssistantId: assistant?.uid || assistantId || null,
    })

    if (!user || user.gold <= 0) {
        return 'Sorry, you have run out of credits. Get more Gold with Premium: https://my.alldone.app/settings/premium'
    }

    const { model, temperature, instructions, displayName, allowedTools: rawTools } = assistant
    const allowedTools = Array.isArray(rawTools) ? rawTools : []
    console.log('WhatsApp Assistant: Runtime tools loaded', {
        projectId,
        requestedAssistantId: assistantId || null,
        resolvedAssistantId: assistant?.uid || assistantId || null,
        allowedToolsCount: allowedTools.length,
        hasDelegationToggle: allowedTools.includes(TALK_TO_ASSISTANT_TOOL_KEY),
    })
    const toolRuntimeContext = {
        projectId,
        assistantId: assistant.uid || assistantId,
        requestUserId: userId,
    }

    // Extract user timezone
    const userTimezoneOffset =
        user.timezone ?? user.timezoneOffset ?? user.timezoneMinutes ?? user.preferredTimezone ?? null

    // Fetch conversation history from the daily topic
    const historyStart = Date.now()
    const history = await getConversationHistory(projectId, chatId, 10)
    markStage('getConversationHistory', historyStart, { historyCount: history.length })

    // Build messages array
    const messages = []
    await addBaseInstructions(messages, displayName, user.language, instructions, allowedTools, userTimezoneOffset, {
        projectId,
        assistantId: assistant.uid || assistantId,
    })

    if (allowedTools.includes(TALK_TO_ASSISTANT_TOOL_KEY)) {
        messages.push([
            'system',
            'You can delegate work to specialized assistants via tools named talk_to_assistant_*. ' +
                'When a user request matches a specialist (for example writing, marketing, language, research), prefer delegation to that specialist.',
        ])
    }

    // Add WhatsApp-specific formatting rules
    messages.push([
        'system',
        'WhatsApp formatting rules:\n' +
            '- IMPORTANT: Keep responses under 1400 characters. Longer messages get truncated.\n' +
            '- Use *bold* and _italic_ for emphasis (WhatsApp formatting).\n' +
            '- Do not use markdown headers (#), code blocks (```), or tables.\n' +
            '- Use simple bullet points with - for lists.',
    ])

    // Add conversation history
    history.forEach(([role, content]) => {
        messages.push([role, content])
    })

    // Add the current user message unless the caller already stored it in chat history.
    if (!skipCurrentMessageAppend) {
        messages.push(['user', userMessageContent || messageText])
    }

    const lastUserEntry = [...messages].reverse().find(entry => entry[0] === 'user')
    const lastUserContent = lastUserEntry ? lastUserEntry[1] : null
    const imagePartsCount = Array.isArray(lastUserContent)
        ? lastUserContent.filter(part => part?.type === 'image_url').length
        : 0
    console.log('WhatsApp Assistant: Final user prompt payload', {
        userId,
        projectId,
        chatId,
        hasArrayContent: Array.isArray(lastUserContent),
        imagePartsCount,
        textLength: getMessageTextForTokenCounting(lastUserContent || '').length,
    })

    // Call the AI
    const streamInitStart = Date.now()
    const stream = await interactWithChatStream(messages, model, temperature, allowedTools, toolRuntimeContext)
    markStage('interactWithChatStream', streamInitStart)

    // Collect the full response, handling tool calls
    const collectStart = Date.now()
    const responseText = await collectStreamWithToolCalls(
        stream,
        messages,
        model,
        temperature,
        allowedTools,
        projectId,
        assistant.uid || assistantId,
        userId,
        toolRuntimeContext
    )
    markStage('collectStreamWithToolCalls', collectStart, { responseLength: responseText.length })

    // Store AI response in topic and update lastAssistantCommentData for AssistantLine
    const storeAssistantStart = Date.now()
    await storeAssistantMessageInTopic(projectId, chatId, assistant.uid || assistantId, responseText, userId)
    markStage('storeAssistantMessageInTopic', storeAssistantStart)

    // Deduct gold
    try {
        const reduceGoldStart = Date.now()
        const { Tiktoken } = require('@dqbd/tiktoken/lite')
        const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')
        const encoder = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
        await reduceGoldWhenChatWithAI(userId, user.gold, model, responseText, messages, encoder)
        encoder.free()
        markStage('reduceGoldWhenChatWithAI', reduceGoldStart)
    } catch (error) {
        console.error('WhatsApp: Error deducting gold:', error.message)
    }

    // Truncate if too long for WhatsApp (1600 char limit)
    if (responseText.length > MAX_WHATSAPP_MESSAGE_LENGTH) {
        const baseUrl = getBaseUrl()
        const topicLink = `${baseUrl}/projects/${projectId}/chats/${chatId}/chat`
        const truncated =
            responseText.substring(0, MAX_WHATSAPP_MESSAGE_LENGTH) + `...\n\nRead full message: ${topicLink}`
        markStage('responseComplete', requestStart, {
            totalDurationMs: Date.now() - requestStart,
            truncated: true,
            finalLength: truncated.length,
        })
        return truncated
    }

    markStage('responseComplete', requestStart, {
        totalDurationMs: Date.now() - requestStart,
        truncated: false,
        finalLength: responseText.length,
    })
    return responseText
}

function getBaseUrl() {
    let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    if (!projectId) {
        try {
            const cfg = process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
            if (cfg && cfg.projectId) projectId = cfg.projectId
        } catch (_) {}
    }
    if (projectId === 'alldonestaging') return 'https://mystaging.alldone.app'
    return 'https://my.alldone.app'
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
    requestUserId,
    toolRuntimeContext = null
) {
    let responseText = ''
    let currentConversation = conversationHistory
    const toolEvidence = {
        createTask: {
            called: false,
            succeeded: false,
            taskId: null,
            projectId: null,
        },
    }

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
                const allowed = await isToolAllowedForExecution(allowedTools, toolName, toolRuntimeContext)
                if (!allowed) {
                    console.warn('WhatsApp: Tool not permitted:', toolName)
                    responseText += `\n\nTool not permitted: ${toolName}`
                    return responseText
                }

                console.log('WhatsApp: Executing tool:', { toolName, toolArgs, iteration: toolCallIteration })

                // Execute tool
                let toolResult
                try {
                    const normalizedToolArgs = normalizeWhatsAppToolArgs(toolName, toolArgs, projectId)
                    toolResult = await executeToolNatively(
                        toolName,
                        normalizedToolArgs,
                        projectId,
                        assistantId,
                        requestUserId,
                        {
                            message: getMessageTextForTokenCounting(
                                conversationHistory.find(m => m[0] === 'user')?.[1]
                            ),
                        }
                    )

                    if (toolName === 'create_task') {
                        const taskId = toolResult?.taskId || toolResult?.taskid || null
                        const createdProjectId = toolResult?.projectId || toolResult?.projectid || null
                        const success = toolResult?.success === true

                        toolEvidence.createTask.called = true
                        toolEvidence.createTask.taskId = taskId
                        toolEvidence.createTask.projectId = createdProjectId
                        toolEvidence.createTask.succeeded = success && !!taskId && !!createdProjectId

                        if (success && (!taskId || !createdProjectId)) {
                            throw new Error('create_task returned success without taskId/projectId')
                        }
                    }
                } catch (error) {
                    console.error('WhatsApp: Tool execution failed:', error.message)
                    responseText += `\n\nError executing ${toolName}: ${error.message}`
                    return toolName === 'create_task' ? TASK_CREATION_FAILURE_MESSAGE : GENERIC_TOOL_FAILURE_MESSAGE
                }

                // Build updated conversation with tool result
                const delegationFailed =
                    toolName.startsWith(TALK_TO_ASSISTANT_TOOL_PREFIX) &&
                    toolResult &&
                    typeof toolResult === 'object' &&
                    toolResult.success === false
                const followUpInstruction = delegationFailed
                    ? `The delegated assistant result indicates failure (status: ${toolResult.status || 'unknown'}). ` +
                      `Do not claim completion. Try another suitable talk_to_assistant_* tool now, or explain exactly what is missing if no suitable tool exists.`
                    : 'Based on the tool results above, provide your response to the user. If any tool result indicates failure, blocked status, or no execution, do not claim completion. Explain what is missing and what should be tried next. If needed, call other available tools.'

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
                        content: followUpInstruction,
                    },
                ]

                currentConversation = updatedConversation

                // Get new stream with tool results
                const newStream = await interactWithChatStream(
                    updatedConversation,
                    modelKey,
                    temperatureKey,
                    allowedTools,
                    toolRuntimeContext
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

    return enforceSafeTaskResponse(responseText.trim(), toolEvidence)
}

function enforceSafeTaskResponse(responseText, toolEvidence) {
    if (!responseText) return responseText

    if (containsUndefinedPlaceholders(responseText)) {
        console.warn('WhatsApp: Blocking assistant response with undefined placeholders')
        return TASK_CREATION_FAILURE_MESSAGE
    }

    const createTaskEvidence = toolEvidence?.createTask
    if (createTaskEvidence?.called && !createTaskEvidence?.succeeded) {
        console.warn('WhatsApp: Blocking assistant task success message due to missing create_task IDs', {
            taskId: createTaskEvidence.taskId,
            projectId: createTaskEvidence.projectId,
        })
        return TASK_CREATION_FAILURE_MESSAGE
    }

    if (mentionsTaskCreation(responseText) && !createTaskEvidence?.called) {
        console.warn('WhatsApp: Blocking assistant task creation claim without create_task tool call evidence')
        return TASK_CREATION_FAILURE_MESSAGE
    }

    return responseText
}

function containsUndefinedPlaceholders(text) {
    if (!text) return false
    return /\bundefined\b/i.test(text)
}

function mentionsTaskCreation(text) {
    if (!text) return false
    const taskCreationPatterns = [
        /\bcreated (a |the )?(new )?(task|todo)\b/i,
        /\b(task|todo)\b.{0,30}\b(created|added)\b/i,
        /\badded (a |the )?(new )?(task|todo)\b/i,
        /\baufgabe\b.{0,30}\b(erstellt|angelegt)\b/i,
        /\b(erstellt|angelegt)\b.{0,30}\baufgabe\b/i,
    ]
    return taskCreationPatterns.some(pattern => pattern.test(text))
}

function normalizeWhatsAppToolArgs(toolName, toolArgs, fallbackProjectId) {
    if (toolName !== 'create_task') return toolArgs

    const hasProjectId = typeof toolArgs?.projectId === 'string' && toolArgs.projectId.trim().length > 0
    const hasProjectName = typeof toolArgs?.projectName === 'string' && toolArgs.projectName.trim().length > 0

    if (hasProjectId || hasProjectName || !fallbackProjectId) return toolArgs

    console.log('WhatsApp: create_task missing project, defaulting to context project', {
        fallbackProjectId,
    })

    return {
        ...toolArgs,
        projectId: fallbackProjectId,
    }
}

module.exports = {
    processWhatsAppAssistantMessage,
}

function createStageTimer(prefix, baseMeta = {}) {
    return (stage, stageStartMs, meta = {}) => {
        const durationMs = Date.now() - stageStartMs
        console.log(`${prefix}: ${stage}`, {
            ...baseMeta,
            ...meta,
            durationMs,
        })
    }
}
