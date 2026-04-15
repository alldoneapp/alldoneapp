'use strict'

const {
    addBaseInstructions,
    buildConversationSafeToolResult,
    buildPendingAttachmentPayload,
    executeToolNatively,
    getAssistantForChat,
    getMessageTextForTokenCounting,
    injectPendingAttachmentIntoToolArgs,
    interactWithChatStream,
    isToolAllowedForExecution,
    reduceGoldWhenChatWithAI,
    THREAD_CONTEXT_MESSAGE_LIMIT,
} = require('../Assistant/assistantHelper')
const { resolveUserTimezoneOffset, resolveUserTimezoneName } = require('../Assistant/contextTimestampHelper')
const { getUserData } = require('../Users/usersFirestore')
const { TASK_CREATION_FAILURE_MESSAGE, getUserFacingToolErrorMessage } = require('../WhatsApp/whatsAppToolErrorUtils')
const { getConversationHistory, storeEmailAssistantMessageInTopic } = require('./emailDailyTopic')
const { getEmailSafeAllowedTools } = require('./emailChannelHelpers')

const MAX_TOOL_ITERATIONS = 50

async function processAnnaEmailAssistantMessage(userId, projectId, chatId, messageText, assistantId, options = {}) {
    const user = await getUserData(userId)
    const assistant = await getAssistantForChat(projectId, assistantId, userId)

    if (!user || user.gold <= 0) {
        const responseText = 'I could not process this email because the account has no remaining credits.'
        await storeEmailAssistantMessageInTopic(projectId, chatId, assistant.uid || assistantId, responseText, userId, {
            status: 'failed_no_credits',
            toEmail: options.toEmail || '',
            subject: options.subject || '',
            messageId: options.messageId || '',
        })
        return responseText
    }

    const allowedTools = getEmailSafeAllowedTools(assistant.allowedTools)
    const messages = []
    const userTimezoneOffset = resolveUserTimezoneOffset(user)
    const userTimezoneName = resolveUserTimezoneName(user)
    const toolRuntimeContext = {
        projectId,
        assistantId: assistant.uid || assistantId,
        requestUserId: userId,
        channel: 'email',
        initialPendingAttachmentPayload: options.initialPendingAttachmentPayload || null,
        userTimezoneName,
    }

    await addBaseInstructions(
        messages,
        assistant.displayName,
        user.language,
        assistant.instructions,
        allowedTools,
        userTimezoneOffset,
        toolRuntimeContext
    )

    messages.push([
        'system',
        'Email channel rules:\n' +
            '- This channel is action-only. Do not reveal private account, project, or message history data.\n' +
            '- Only use the available tools. If a request needs any other tool or data retrieval, explain that it is not available by email.\n' +
            '- Keep the email reply concise and outcome-focused.\n' +
            '- Do not claim that a task or external action succeeded unless the tool result confirms success.\n' +
            '- If an invoice or other attachment was included in the email, the first external tool call can receive that file automatically.',
    ])

    const history = await getConversationHistory(projectId, chatId, THREAD_CONTEXT_MESSAGE_LIMIT, userTimezoneOffset)
    history.forEach(([role, content]) => messages.push([role, content]))
    if (!options.skipCurrentMessageAppend && String(messageText || '').trim()) {
        messages.push(['user', messageText])
    }

    const stream = await interactWithChatStream(
        messages,
        assistant.model,
        assistant.temperature,
        allowedTools,
        toolRuntimeContext
    )
    let responseText
    try {
        responseText = await collectStreamWithToolCalls(
            stream,
            messages,
            assistant.model,
            assistant.temperature,
            allowedTools,
            projectId,
            assistant.uid || assistantId,
            userId,
            toolRuntimeContext
        )
    } catch (error) {
        responseText = 'I could not complete this email request right now. Please try again later.'
    }

    await storeEmailAssistantMessageInTopic(projectId, chatId, assistant.uid || assistantId, responseText, userId, {
        status: options.replyStatus || 'processed',
        toEmail: options.toEmail || '',
        subject: options.subject || '',
        messageId: options.messageId || '',
    })

    try {
        const { Tiktoken } = require('@dqbd/tiktoken/lite')
        const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')
        const encoder = new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
        await reduceGoldWhenChatWithAI(userId, user.gold, assistant.model, responseText, messages, encoder)
        encoder.free()
    } catch (error) {
        console.error('Email Channel: Failed deducting gold', { error: error.message })
    }

    return responseText
}

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
    let pendingAttachmentPayload = toolRuntimeContext?.initialPendingAttachmentPayload || null
    const toolEvidence = {
        createTask: {
            called: false,
            succeeded: false,
            taskId: null,
            projectId: null,
        },
    }

    for await (const chunk of stream) {
        if (chunk.additional_kwargs?.tool_calls && Array.isArray(chunk.additional_kwargs.tool_calls)) {
            let currentToolCalls = chunk.additional_kwargs.tool_calls
            let toolCallIteration = 0

            while (currentToolCalls && currentToolCalls.length > 0 && toolCallIteration < MAX_TOOL_ITERATIONS) {
                toolCallIteration++
                const toolCall = currentToolCalls[0]
                const toolName = toolCall.function.name
                const toolCallId = toolCall.id

                let toolArgs = {}
                try {
                    toolArgs = JSON.parse(toolCall.function.arguments)
                } catch (error) {
                    throw new Error(`Failed to parse tool arguments for ${toolName}`)
                }

                const enrichedToolArgs = injectPendingAttachmentIntoToolArgs(
                    toolName,
                    toolArgs,
                    pendingAttachmentPayload
                )
                toolArgs = normalizeEmailToolArgs(toolName, enrichedToolArgs.toolArgs, projectId)
                if (enrichedToolArgs.usedPendingAttachment) pendingAttachmentPayload = null

                const allowed = await isToolAllowedForExecution(allowedTools, toolName, toolRuntimeContext)
                if (!allowed) {
                    throw new Error(`Tool not permitted: ${toolName}`)
                }

                let toolResult
                try {
                    toolResult = await executeToolNatively(
                        toolName,
                        toolArgs,
                        projectId,
                        assistantId,
                        requestUserId,
                        {
                            message: getMessageTextForTokenCounting(
                                conversationHistory.find(entry => entry[0] === 'user')?.[1] || ''
                            ),
                        },
                        toolRuntimeContext
                    )
                    pendingAttachmentPayload =
                        buildPendingAttachmentPayload(toolName, toolResult) || pendingAttachmentPayload

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
                    return getUserFacingToolErrorMessage(toolName, error)
                }

                const followUpInstruction =
                    'Based on the tool result above, provide the final email reply. If the tool result indicates failure or no execution, do not claim completion.'

                currentConversation = [
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
                        content: JSON.stringify(buildConversationSafeToolResult(toolName, toolResult)),
                        tool_call_id: toolCallId,
                    },
                    {
                        role: 'user',
                        content: followUpInstruction,
                    },
                ]

                const newStream = await interactWithChatStream(
                    currentConversation,
                    modelKey,
                    temperatureKey,
                    allowedTools,
                    toolRuntimeContext
                )

                let nextToolCalls = null
                for await (const newChunk of newStream) {
                    if (newChunk.additional_kwargs?.tool_calls) {
                        nextToolCalls = newChunk.additional_kwargs.tool_calls
                    } else if (newChunk.content) {
                        responseText += newChunk.content
                    }
                }

                currentToolCalls = nextToolCalls && nextToolCalls.length > 0 ? nextToolCalls : null
            }

            if (toolCallIteration >= MAX_TOOL_ITERATIONS) {
                responseText += '\n\nMaximum tool call iterations reached.'
            }
            break
        }

        if (chunk.content) responseText += chunk.content
    }

    return enforceSafeTaskResponse(String(responseText || '').trim(), toolEvidence)
}

function normalizeEmailToolArgs(toolName, toolArgs, fallbackProjectId) {
    if (toolName !== 'create_task') return toolArgs

    const hasProjectId = typeof toolArgs?.projectId === 'string' && toolArgs.projectId.trim().length > 0
    const hasProjectName = typeof toolArgs?.projectName === 'string' && toolArgs.projectName.trim().length > 0
    if (hasProjectId || hasProjectName || !fallbackProjectId) return toolArgs

    return {
        ...toolArgs,
        projectId: fallbackProjectId,
    }
}

function enforceSafeTaskResponse(responseText, toolEvidence) {
    if (!responseText) return responseText

    if (/\bundefined\b/i.test(responseText)) {
        return TASK_CREATION_FAILURE_MESSAGE
    }

    const createTaskEvidence = toolEvidence?.createTask
    if (createTaskEvidence?.called && !createTaskEvidence?.succeeded) {
        return TASK_CREATION_FAILURE_MESSAGE
    }

    if (mentionsTaskCreation(responseText) && !createTaskEvidence?.called) {
        return TASK_CREATION_FAILURE_MESSAGE
    }

    return responseText
}

function mentionsTaskCreation(text) {
    if (!text) return false
    return [
        /\bcreated (a |the )?(new )?(task|todo)\b/i,
        /\b(task|todo)\b.{0,30}\b(created|added)\b/i,
        /\badded (a |the )?(new )?(task|todo)\b/i,
        /\baufgabe\b.{0,30}\b(erstellt|angelegt)\b/i,
        /\b(erstellt|angelegt)\b.{0,30}\baufgabe\b/i,
    ].some(pattern => pattern.test(text))
}

module.exports = {
    processAnnaEmailAssistantMessage,
}
