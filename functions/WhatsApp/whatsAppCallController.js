const admin = require('firebase-admin')
const WebSocket = require('ws')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const {
    addBaseInstructions,
    buildCompactThreadContextMessage,
    buildConversationSafeToolResult,
    executeToolNatively,
    filterAllowedToolsForRuntimeContext,
    getAssistantForChat,
    getDynamicToolSchemasWithCache,
    getOpenTasksContextMessage,
    isToolAllowedForExecution,
    loadAssistantThreadState,
} = require('../Assistant/assistantHelper')
const { THREAD_CONTEXT_MESSAGE_LIMIT } = require('../Assistant/contextLimits')
const { resolveUserTimezoneOffset } = require('../Assistant/contextTimestampHelper')
const { getConversationHistory } = require('./whatsAppDailyTopic')
const { getWhatsAppCallConfig, normalizeRealtimeVoice } = require('./whatsAppCallConfig')
const { reconcileCallUsage } = require('./whatsAppCallGold')
const { getSafeCallErrorDetails } = require('./whatsAppCallPrivacy')
const { EMPTY_CALL_RECAP, generateCallRecap } = require('./whatsAppCallRecap')
const {
    VOICE_INSTRUCTIONS,
    buildCallBootstrapInstructions,
    buildCallGreetingInstruction,
    buildCallIdentityInstruction,
    buildCallLanguageInstruction,
} = require('./whatsAppCallPrompt')
const {
    CONFIRMATION_TOOL_NAME,
    buildRealtimeToolSchemas,
    canApprovePendingAction,
    getAssistantTranscriptsFromResponse,
    getFunctionCallsFromResponse,
    getResponseTotalTokens,
    requiresVoiceConfirmation,
} = require('./whatsAppCallTools')
const {
    FINAL_STATUSES,
    claimRecap,
    cleanupExpiredCallSessions,
    finalizeCallSession,
    getCallSession,
    updateCallSession,
} = require('./whatsAppCallSessions')
const { getCallTranscript, getCallTranscriptTurn, storeCallTranscriptTurn } = require('./whatsAppCallTranscript')

const MAX_SIDEBAND_RECONNECTS = 3
const RECONNECT_DELAY_MS = 1000
const CLOSING_GRACE_MS = 3500
const CONTROLLER_FINALIZATION_RESERVE_SECONDS = 30

function getTextFromHistoryContent(content) {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return String(content || '')
    return content
        .map(item => item?.text || item?.content || '')
        .filter(Boolean)
        .join(' ')
}

function buildRealtimeSessionUpdate({ config, assistant, instructions, tools, includeVoice = true }) {
    return {
        type: 'session.update',
        session: {
            type: 'realtime',
            model: config.realtimeModel,
            output_modalities: ['audio'],
            instructions,
            reasoning: { effort: config.reasoningEffort },
            audio: {
                input: {
                    transcription: { model: config.transcriptionModel },
                    turn_detection: {
                        type: 'semantic_vad',
                        eagerness: 'auto',
                        create_response: true,
                        interrupt_response: true,
                    },
                },
                ...(includeVoice ? { output: { voice: normalizeRealtimeVoice(assistant?.realtimeVoice) } } : {}),
            },
            tools,
            tool_choice: 'auto',
        },
    }
}

function createConversationItem(role, content) {
    return {
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role,
            content: [
                {
                    type: role === 'assistant' ? 'output_text' : 'input_text',
                    text: getTextFromHistoryContent(content),
                },
            ],
        },
    }
}

function parseToolArguments(value) {
    if (!value) return {}
    if (typeof value === 'object') return value
    return JSON.parse(value)
}

function serializeToolResult(result) {
    try {
        return JSON.stringify(result === undefined ? { success: true } : result)
    } catch (_) {
        return JSON.stringify({ success: false, error: 'Tool result could not be serialized.' })
    }
}

async function buildCallBootstrapContext(session) {
    const userDocPromise = admin.firestore().doc(`users/${session.userId}`).get()
    const assistantPromise = getAssistantForChat(session.projectId, session.assistantId, session.userId)
    const compactedThreadStatePromise = loadAssistantThreadState(
        admin.firestore(),
        session.projectId,
        'topics',
        session.chatId,
        session.assistantId
    ).catch(() => null)

    // History must be fetched with the user's timezone (for correct timestamps) and the
    // compaction trim point (to drop messages already summarized), so resolve those first.
    const userDoc = await userDocPromise
    const user = userDoc.exists ? userDoc.data() || {} : {}
    const userTimezoneOffset = resolveUserTimezoneOffset(user)
    const compactedThreadState = await compactedThreadStatePromise
    const trimHistoryBeforeMs =
        compactedThreadState && Number.isFinite(Number(compactedThreadState.trimHistoryBeforeMs))
            ? Number(compactedThreadState.trimHistoryBeforeMs)
            : 0

    const [assistant, history] = await Promise.all([
        assistantPromise,
        getConversationHistory(
            session.projectId,
            session.chatId,
            THREAD_CONTEXT_MESSAGE_LIMIT,
            userTimezoneOffset,
            trimHistoryBeforeMs
        ),
    ])
    const runtimeContext = {
        projectId: session.projectId,
        assistantId: session.assistantId,
        requestUserId: session.userId,
        objectType: 'topics',
        objectId: session.chatId,
        sourceChannel: 'whatsapp_call',
    }
    const allowedTools = filterAllowedToolsForRuntimeContext(assistant.allowedTools || [], runtimeContext)

    return {
        assistant,
        user,
        userTimezoneOffset,
        compactedThreadState,
        history,
        runtimeContext,
        allowedTools,
        tools: [],
        instructions: buildCallBootstrapInstructions(assistant, user.language),
    }
}

async function completeCallContext(context) {
    const dynamicTools = await getDynamicToolSchemasWithCache(context.allowedTools, context.runtimeContext)
    const tools = buildRealtimeToolSchemas(context.allowedTools, dynamicTools)
    const userTimezoneOffset = Number.isFinite(context.userTimezoneOffset) ? context.userTimezoneOffset : null
    const baseMessages = []
    await addBaseInstructions(
        baseMessages,
        context.assistant.displayName || context.assistant.name || 'Assistant',
        context.user.language || 'English',
        context.assistant.instructions,
        context.allowedTools,
        userTimezoneOffset,
        {
            ...context.runtimeContext,
            userTimezoneName: context.user.timezoneName || context.user.timezone || null,
        }
    )

    const compactedContextMessage = context.compactedThreadState
        ? buildCompactThreadContextMessage(context.compactedThreadState)
        : ''
    if (compactedContextMessage) baseMessages.push(['system', compactedContextMessage])

    baseMessages.push(['system', buildCallLanguageInstruction(context.user.language)])
    baseMessages.push(['system', buildCallIdentityInstruction(context.assistant)])
    baseMessages.push(['system', VOICE_INSTRUCTIONS])

    try {
        const openTasksContext = await getOpenTasksContextMessage(
            context.runtimeContext.requestUserId,
            userTimezoneOffset
        )
        if (openTasksContext?.message) baseMessages.push(['system', openTasksContext.message])
    } catch (error) {
        console.warn('WhatsApp Call: Failed to load open tasks context', {
            error: getSafeCallErrorDetails(error),
        })
    }

    return {
        ...context,
        tools,
        instructions: baseMessages
            .map(([, text]) => String(text || ''))
            .filter(Boolean)
            .join('\n\n'),
    }
}

async function buildCallContext(session) {
    return completeCallContext(await buildCallBootstrapContext(session))
}

async function hangUpOpenAICall(config, openAiCallId) {
    if (!openAiCallId) return
    const response = await fetch(
        `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(openAiCallId)}/hangup`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.openAiApiKey}` },
        }
    )
    if (!response.ok && response.status !== 404) {
        throw new Error(`OpenAI hangup failed with HTTP ${response.status}`)
    }
}

async function sendCallRecap(sessionId) {
    const claimed = await claimRecap(sessionId)
    if (!claimed) return { sent: false, reason: 'already_claimed' }

    const config = getWhatsAppCallConfig()
    const session = await getCallSession(sessionId)
    if (!session) return { sent: false, reason: 'session_not_found' }

    const storedRecap = await getCallTranscriptTurn({
        sessionId,
        turnId: 'post_call_recap',
        role: 'assistant',
        projectId: session.projectId,
        chatId: session.chatId,
    })
    let recap = storedRecap?.text ? { text: storedRecap.text.replace(/^Call recap:\s*/i, '') } : null

    if (!recap) {
        try {
            recap = await generateCallRecap(config, session, await getCallTranscript(session))
            if (recap.tokens > 0) {
                await reconcileCallUsage({
                    sessionId,
                    eventId: `recap:${sessionId}`,
                    totalTokens: recap.tokens,
                })
            }
        } catch (error) {
            console.warn('WhatsApp Call: Recap generation failed', {
                sessionId,
                error: getSafeCallErrorDetails(error),
            })
            recap = { text: EMPTY_CALL_RECAP }
        }
        await storeCallTranscriptTurn({
            sessionId,
            turnId: 'post_call_recap',
            role: 'assistant',
            text: `Call recap: ${recap.text}`,
            projectId: session.projectId,
            chatId: session.chatId,
            userId: session.userId,
            assistantId: session.assistantId,
        })
    }

    try {
        const userDoc = await admin.firestore().doc(`users/${session.userId}`).get()
        const phone = userDoc.exists ? userDoc.data()?.phone : null
        if (!phone) throw new Error('Linked WhatsApp number is unavailable')
        const delivery = await new TwilioWhatsAppService().sendWhatsAppMessage(phone, `Call recap: ${recap.text}`, {
            suppressSensitiveLogging: true,
        })
        if (!delivery?.success) throw new Error('WhatsApp recap delivery failed')
        await updateCallSession(sessionId, { recapStatus: 'sent', recapSentAt: Date.now() })
        return { sent: true }
    } catch (error) {
        await updateCallSession(sessionId, { recapStatus: 'failed', recapError: 'delivery_failed' })
        console.warn('WhatsApp Call: Recap delivery failed', {
            sessionId,
            error: getSafeCallErrorDetails(error),
        })
        return { sent: false, reason: 'delivery_failed' }
    }
}

async function finalizeControllerCall(sessionId, reason, status = 'completed') {
    await updateCallSession(sessionId, { controllerFinishedAt: Date.now() }).catch(() => {})
    await finalizeCallSession(sessionId, reason, status)
    await sendCallRecap(sessionId)
}

async function runWhatsAppRealtimeCall(sessionId) {
    const config = getWhatsAppCallConfig()
    const session = await getCallSession(sessionId)
    if (!session) return
    if (FINAL_STATUSES.has(session.status)) {
        await sendCallRecap(sessionId)
        return
    }
    if (!session.openAiCallId) return

    let context
    try {
        context = await buildCallBootstrapContext(session)
    } catch (error) {
        console.error('WhatsApp Call: Controller setup failed', {
            sessionId,
            error: getSafeCallErrorDetails(error),
        })
        await updateCallSession(sessionId, {
            lastError: String(error?.code || error?.name || 'controller_setup_error'),
        }).catch(() => {})
        await hangUpOpenAICall(config, session.openAiCallId).catch(() => {})
        await finalizeControllerCall(sessionId, 'controller_setup_error', 'failed')
        return
    }
    const contextEnrichmentStartedAt = Date.now()
    const contextEnrichmentPromise = completeCallContext(context)
        .then(fullContext => {
            context = fullContext
            return fullContext
        })
        .catch(error => {
            console.warn('WhatsApp Call: Full context enrichment failed; continuing with bootstrap context', {
                sessionId,
                error: getSafeCallErrorDetails(error),
            })
            updateCallSession(sessionId, {
                lastError: String(error?.code || error?.name || 'context_enrichment_error'),
            }).catch(() => {})
            return null
        })
    const deadline =
        (Number(session.startedAt) || Date.now()) +
        Math.max(10, config.maxDurationSeconds - CONTROLLER_FINALIZATION_RESERVE_SECONDS) * 1000
    let socket = null
    let ending = false
    let completionReason = 'sideband_closed'
    let completionStatus = 'completed'
    let pendingAction = null
    let lastUserTurn = null
    let processing = Promise.resolve()
    let initialized = false

    const send = payload => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
    }
    const sendFunctionOutput = (callId, result) => {
        send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: callId, output: serializeToolResult(result) },
        })
    }
    const requestResponse = instructions => {
        send({ type: 'response.create', response: instructions ? { instructions } : {} })
    }
    const closeCall = async (reason, status = 'completed', closingMessage = '') => {
        if (ending) return
        ending = true
        completionReason = reason
        completionStatus = status
        if (closingMessage) requestResponse(closingMessage)
        await new Promise(resolve => setTimeout(resolve, closingMessage ? CLOSING_GRACE_MS : 250))
        await hangUpOpenAICall(config, session.openAiCallId).catch(error => {
            console.warn('WhatsApp Call: Hangup failed', {
                sessionId,
                error: getSafeCallErrorDetails(error),
            })
        })
        socket?.close()
    }

    const persistTurn = async (role, turnId, text) => {
        await storeCallTranscriptTurn({
            sessionId,
            turnId,
            role,
            text,
            projectId: session.projectId,
            chatId: session.chatId,
            userId: session.userId,
            assistantId: session.assistantId,
        })
    }

    const executeAllowedTool = async (toolName, toolArgs) => {
        const allowed = await isToolAllowedForExecution(context.allowedTools, toolName, context.runtimeContext)
        if (!allowed) throw new Error(`Tool not permitted: ${toolName}`)
        const result = await executeToolNatively(
            toolName,
            toolArgs,
            session.projectId,
            session.assistantId,
            session.userId,
            null,
            context.runtimeContext
        )
        return buildConversationSafeToolResult(toolName, result)
    }

    const handleToolCall = async call => {
        const toolName = String(call.name || '').trim()
        const callId = call.call_id || call.id
        let toolArgs
        try {
            toolArgs = parseToolArguments(call.arguments)
        } catch (_) {
            sendFunctionOutput(callId, { success: false, error: 'Invalid tool arguments.' })
            requestResponse()
            return
        }

        if (toolName === CONFIRMATION_TOOL_NAME) {
            if (!pendingAction) {
                sendFunctionOutput(callId, { success: false, status: 'no_pending_action' })
                requestResponse('Tell the caller there is no pending action to confirm.')
                return
            }
            if (toolArgs.approved !== true) {
                const cancelledTool = pendingAction.toolName
                pendingAction = null
                await updateCallSession(sessionId, {
                    pendingConfirmationTool: null,
                    pendingConfirmationAt: null,
                    confirmationRejections: admin.firestore.FieldValue.increment(1),
                })
                sendFunctionOutput(callId, { success: true, status: 'cancelled', toolName: cancelledTool })
                requestResponse('Briefly tell the caller the pending action was cancelled.')
                return
            }
            if (!canApprovePendingAction(pendingAction, lastUserTurn)) {
                sendFunctionOutput(callId, { success: false, status: 'explicit_spoken_approval_required' })
                requestResponse('Ask the caller for a clear yes or no confirmation for the pending action.')
                return
            }

            const approvedAction = pendingAction
            pendingAction = null
            await updateCallSession(sessionId, {
                pendingConfirmationTool: null,
                pendingConfirmationAt: null,
                confirmationApprovals: admin.firestore.FieldValue.increment(1),
            })
            try {
                const result = await executeAllowedTool(approvedAction.toolName, approvedAction.toolArgs)
                sendFunctionOutput(callId, result)
            } catch (_) {
                sendFunctionOutput(callId, { success: false, error: 'Tool execution failed.' })
            }
            requestResponse()
            return
        }

        if (requiresVoiceConfirmation(toolName)) {
            if (pendingAction) {
                sendFunctionOutput(callId, {
                    success: false,
                    status: 'pending_confirmation_exists',
                    toolName: pendingAction.toolName,
                })
                requestResponse('Ask the caller to approve or reject the existing pending action first.')
                return
            }
            pendingAction = { toolName, toolArgs, requestedAt: Date.now() }
            await updateCallSession(sessionId, {
                pendingConfirmationTool: toolName,
                pendingConfirmationAt: pendingAction.requestedAt,
                confirmationRequests: admin.firestore.FieldValue.increment(1),
            })
            sendFunctionOutput(callId, {
                success: false,
                status: 'confirmation_required',
                toolName,
                message: 'Ask the caller to explicitly approve or reject this exact action.',
            })
            requestResponse(
                'Ask one concise confirmation question for the exact pending action. Do not execute it yet.'
            )
            return
        }

        try {
            sendFunctionOutput(callId, await executeAllowedTool(toolName, toolArgs))
        } catch (_) {
            sendFunctionOutput(callId, { success: false, error: 'Tool execution failed.' })
        }
        requestResponse()
    }

    const handleEvent = async event => {
        if (event.type === 'error') {
            const errorCode = String(event.error?.code || event.error?.type || 'openai_realtime_error').slice(0, 120)
            console.warn('WhatsApp Call: OpenAI Realtime error event', { sessionId, errorCode })
            await updateCallSession(sessionId, { lastOpenAIErrorCode: errorCode })
            return
        }
        if (event.type === 'conversation.item.input_audio_transcription.completed') {
            const transcript = String(event.transcript || '').trim()
            if (transcript) {
                lastUserTurn = { text: transcript, createdAt: Date.now() }
                await persistTurn('user', event.item_id || event.event_id || `user_${Date.now()}`, transcript)
            }
            return
        }
        if (event.type === 'response.output_audio_transcript.done') {
            await persistTurn(
                'assistant',
                event.item_id || event.response_id || event.event_id || `assistant_${Date.now()}`,
                event.transcript
            )
            return
        }
        if (event.type !== 'response.done' || !event.response) return

        const response = event.response
        for (const transcript of getAssistantTranscriptsFromResponse(response)) {
            await persistTurn('assistant', transcript.itemId || response.id, transcript.text)
        }

        const tokens = getResponseTotalTokens(response)
        if (tokens > 0) {
            const gold = await reconcileCallUsage({
                sessionId,
                eventId: response.id || event.event_id,
                totalTokens: tokens,
            })
            if (!gold.success) {
                await closeCall(
                    'billing_error',
                    'failed',
                    'Briefly tell the caller the call is ending because billing could not be completed.'
                )
                return
            }
            if (gold.insufficientBalance) {
                await closeCall(
                    'insufficient_gold',
                    'completed',
                    'Briefly tell the caller their Gold balance is exhausted and the call is ending now.'
                )
                return
            }
        }

        for (const call of getFunctionCallsFromResponse(response)) {
            await handleToolCall(call)
        }
    }

    const initializeSocket = () => {
        send(
            buildRealtimeSessionUpdate({
                config,
                assistant: context.assistant,
                instructions: context.instructions,
                tools: context.tools,
                includeVoice: false,
            })
        )
        if (!initialized) {
            context.history.forEach(([role, content]) => send(createConversationItem(role, content)))
            requestResponse(buildCallGreetingInstruction(context.assistant, context.user.language))
            initialized = true
        }
    }

    contextEnrichmentPromise.then(fullContext => {
        if (!fullContext || ending || socket?.readyState !== WebSocket.OPEN) return
        send(
            buildRealtimeSessionUpdate({
                config,
                assistant: context.assistant,
                instructions: context.instructions,
                tools: context.tools,
                includeVoice: false,
            })
        )
        updateCallSession(sessionId, {
            contextReadyAt: Date.now(),
            contextEnrichmentMs: Math.max(0, Date.now() - contextEnrichmentStartedAt),
        }).catch(() => {})
        console.log('WhatsApp Call: Full context ready', {
            sessionId,
            contextEnrichmentMs: Math.max(0, Date.now() - contextEnrichmentStartedAt),
        })
    })

    const runSocketAttempt = () =>
        new Promise((resolve, reject) => {
            socket = new WebSocket(
                `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(session.openAiCallId)}`,
                {
                    headers: {
                        Authorization: `Bearer ${config.openAiApiKey}`,
                    },
                }
            )
            socket.once('open', () => {
                const connectedAt = Date.now()
                const setupLatencyMs = Math.max(0, connectedAt - Number(session.createdAt || connectedAt))
                updateCallSession(sessionId, {
                    status: 'controller_running',
                    lastConnectedAt: connectedAt,
                    setupLatencyMs,
                }).catch(() => {})
                console.log('WhatsApp Call: Sideband connected', { sessionId, setupLatencyMs })
                initializeSocket()
            })
            socket.on('message', data => {
                processing = processing
                    .then(() => handleEvent(JSON.parse(data.toString())))
                    .catch(error => {
                        console.error('WhatsApp Call: Event processing failed', {
                            sessionId,
                            error: getSafeCallErrorDetails(error),
                        })
                    })
            })
            socket.once('error', reject)
            socket.once('close', code => resolve({ code }))
        })

    const timeout = setTimeout(() => {
        processing = processing.then(() =>
            closeCall(
                'max_duration',
                'completed',
                'Briefly tell the caller the maximum call duration has been reached and the call is ending.'
            )
        )
    }, Math.max(1000, deadline - Date.now()))

    try {
        for (let attempt = 1; attempt <= MAX_SIDEBAND_RECONNECTS && !ending && Date.now() < deadline; attempt++) {
            let closeResult = null
            try {
                closeResult = await runSocketAttempt()
            } catch (error) {
                console.warn('WhatsApp Call: Sideband connection failed', {
                    sessionId,
                    attempt,
                    error: getSafeCallErrorDetails(error),
                })
            }
            if (!ending && closeResult && [1000, 1001].includes(Number(closeResult.code))) {
                ending = true
                completionReason = 'sideband_closed'
                completionStatus = 'completed'
                await updateCallSession(sessionId, { websocketCloseCode: Number(closeResult.code) }).catch(() => {})
                break
            }
            if (!ending && attempt < MAX_SIDEBAND_RECONNECTS && Date.now() < deadline) {
                await updateCallSession(sessionId, { websocketReconnects: attempt })
                await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS * attempt))
            }
        }
        await processing
        if (!ending && Date.now() < deadline) {
            completionReason = 'sideband_reconnects_exhausted'
            completionStatus = 'failed'
            await hangUpOpenAICall(config, session.openAiCallId).catch(() => {})
        }
    } catch (error) {
        completionReason = 'controller_error'
        completionStatus = 'failed'
        console.error('WhatsApp Call: Controller failed', {
            sessionId,
            error: getSafeCallErrorDetails(error),
        })
        await updateCallSession(sessionId, {
            lastError: String(error?.code || error?.name || 'controller_error'),
        }).catch(() => {})
        await hangUpOpenAICall(config, session.openAiCallId).catch(() => {})
    } finally {
        clearTimeout(timeout)
        await finalizeControllerCall(sessionId, completionReason, completionStatus)
    }
}

async function cleanupStaleWhatsAppCalls() {
    const sessionIds = await cleanupExpiredCallSessions()
    const pendingRecaps = await admin
        .firestore()
        .collection('whatsAppCallSessions')
        .where('recapStatus', 'in', ['pending', 'failed', 'generating'])
        .limit(100)
        .get()
    const recapSessionIds = new Set(sessionIds)
    pendingRecaps.docs.forEach(doc => {
        if (FINAL_STATUSES.has(doc.data()?.status)) recapSessionIds.add(doc.id)
    })

    const config = getWhatsAppCallConfig()
    for (const sessionId of sessionIds) {
        const session = await getCallSession(sessionId)
        if (session?.openAiCallId) {
            await hangUpOpenAICall(config, session.openAiCallId).catch(() => {})
        }
    }
    for (const sessionId of recapSessionIds) {
        await sendCallRecap(sessionId)
    }
    return sessionIds.length
}

module.exports = {
    buildCallBootstrapContext,
    buildCallContext,
    buildRealtimeSessionUpdate,
    cleanupStaleWhatsAppCalls,
    completeCallContext,
    createConversationItem,
    generateCallRecap,
    runWhatsAppRealtimeCall,
    sendCallRecap,
}
