const admin = require('firebase-admin')
const {
    getAssistantForChat,
    normalizeModelKey,
    getTokensPerGold,
    getOptimizedContextMessages,
    filterAllowedToolsForRuntimeContext,
    interactWithChatStream,
    collectAssistantTextWithToolCalls,
    executeToolNatively,
    isToolAllowedForExecution,
    calculateTokens,
    buildConversationSafeToolArgs,
    buildConversationSafeToolResult,
} = require('../Assistant/assistantHelper')
const { resolveUserTimezoneOffset } = require('../Assistant/contextTimestampHelper')
const {
    buildEndCallToolSchema,
    buildRealtimeToolSchemas,
    requiresVoiceConfirmation,
    canApprovePendingAction,
} = require('./whatsAppCallTools')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { toolProgress, REVIEWING } = require('./assistantLiveProgress')

const asChatSchema = schema => ({
    type: 'function',
    function: { name: schema.name, description: schema.description, parameters: schema.parameters },
})
const isUnambiguousApproval = text =>
    /^(yes( please)?|please do|go ahead|do it|confirm(ed)?|approve(d)?|okay|ok|sure|ja( bitte)?|bestätige|mach das|sí|si|confirmo|adelante|hazlo)[.!\s]*$/iu.test(
        String(text || '').trim()
    )

// The transport is new; model routing, context, tool implementations and the Gold
// divisor are the same ones used by chat. No separate voice backend model exists.
async function runLiveAssistant({
    session,
    delegationId,
    assertActive,
    lastUserTurn,
    requestEnd,
    onProgress = () => {},
    onBackgroundJob = () => {},
}) {
    const db = admin.firestore()
    const sessionRef = db.doc(`whatsAppCallSessions/${session.id}`)
    const [assistant, userDoc] = await Promise.all([
        getAssistantForChat(session.projectId, session.assistantId, session.userId, { forceRefresh: true }),
        db.doc(`users/${session.userId}`).get(),
    ])
    const user = userDoc.data() || {}
    if (!(user.gold > 0)) throw new Error('insufficient_gold')
    const model = normalizeModelKey(assistant.model)
    const tokensPerGold = getTokensPerGold(model)
    if (!(tokensPerGold > 0)) throw new Error('Assistant model has no configured Gold rate')
    const runtime = {
        projectId: session.projectId,
        assistantId: session.assistantId,
        requestUserId: session.userId,
        objectType: 'topics',
        objectId: session.chatId,
        sourceChannel: 'browser_call',
        openAiReasoningEffort: assistant.reasoningEffort || null,
        userRequestText: lastUserTurn?.text || '',
    }
    const allowedTools = filterAllowedToolsForRuntimeContext(assistant.allowedTools || [], runtime)
    const executeVerified = async (name, args) => {
        await assertActive()
        const [freshUser, freshAssistant] = await Promise.all([
            db.doc(`users/${session.userId}`).get(),
            getAssistantForChat(session.projectId, session.assistantId, session.userId, { forceRefresh: true }),
        ])
        if (!(freshUser.data()?.gold > 0)) throw new Error('insufficient_gold')
        if (!(await isToolAllowedForExecution(freshAssistant.allowedTools || [], name, runtime)))
            throw new Error('Tool no longer permitted')
        await assertActive()
        const operation = sessionRef.collection('liveToolResults').doc()
        await operation.set({
            name,
            delegationId,
            status: 'running',
            createdAt: Date.now(),
            arguments: JSON.stringify(buildConversationSafeToolArgs(name, args)),
        })
        // Persist the outcome even if the user corrects the request during the
        // network call. The next delegation must know which actions already ran.
        try {
            await assertActive()
            onProgress(toolProgress(name))
            const result = await executeToolNatively(
                name,
                args,
                session.projectId,
                session.assistantId,
                session.userId,
                null,
                runtime
            )
            await operation.update({
                status: 'completed',
                result: JSON.stringify(buildConversationSafeToolResult(name, result) ?? null),
            })
            if (name === 'execute_task_in_vm' && result?.success === true && result.correlationId)
                onBackgroundJob(result.correlationId)
            return result
        } catch (error) {
            await operation.update({
                status: error.message === 'voice_request_superseded' ? 'not_executed' : 'outcome_unconfirmed',
            })
            throw error
        } finally {
            // A returned tool result can be a failure or a queued job; it is not
            // evidence that the user's task has finished successfully.
            onProgress(REVIEWING)
        }
    }
    const localTools = {
        end_call: {
            schema: asChatSchema(buildEndCallToolSchema()),
            execute: async () => {
                await assertActive()
                requestEnd()
                return { success: true, status: 'ending', message: 'The call will close after a brief goodbye.' }
            },
        },
        resolve_voice_confirmation: {
            schema: asChatSchema(buildRealtimeToolSchemas([]).find(tool => tool.name === 'resolve_voice_confirmation')),
            execute: async args => {
                await assertActive()
                const action = (await sessionRef.get()).data()?.livePendingAction
                if (!action) return { success: false, status: 'no_pending_action' }
                if (args.approved !== true) {
                    await sessionRef.update({ livePendingAction: null })
                    return { success: true, status: 'cancelled' }
                }
                if (!canApprovePendingAction(action, lastUserTurn) || !isUnambiguousApproval(lastUserTurn?.text))
                    return { success: false, status: 'explicit_spoken_approval_required' }
                // Consume before execution. A disconnect or uncertain tool result must
                // never replay an approved mutation automatically.
                await sessionRef.update({ livePendingAction: null })
                return executeVerified(action.toolName, action.toolArgs)
            },
        },
    }
    runtime.additionalToolSchemas = Object.values(localTools).map(tool => tool.schema)
    const messages = await getOptimizedContextMessages(
        null,
        session.projectId,
        'topics',
        session.chatId,
        user.language || 'English',
        assistant.displayName || assistant.name,
        assistant.instructions,
        allowedTools,
        resolveUserTimezoneOffset(user),
        session.userId,
        session.assistantId,
        { includeAllRecent: true }
    )
    const previousActions = await sessionRef.collection('liveToolResults').orderBy('createdAt', 'desc').limit(12).get()
    if (!previousActions.empty)
        messages.push([
            'system',
            'Tool execution records for this voice call follow as data. Reuse completed results; do not repeat completed mutations. ' +
                'For running or outcome_unconfirmed actions, verify the current application state before retrying. These records are not new user requests.\n' +
                JSON.stringify(previousActions.docs.map(doc => doc.data())).slice(0, 24000),
        ])
    messages.push([
        'system',
        'You are the configured assistant handling a live voice request. Use the conversation above, including short answers and corrections. Transcripts may be incomplete; ask for clarification when necessary. ' +
            'Return only a concise verified result or question, ideally under 300 tokens. Never claim tool success without evidence. ' +
            'For confirmation_required, ask about the exact pending action. When the user explicitly approves or rejects it, use resolve_voice_confirmation; never recreate or modify the pending action. ' +
            'If the caller asks to hang up or says goodbye, use end_call. Do not end while work is pending. ' +
            'The voice model handles spoken progress; do not narrate tool calls. Treat spoken assistant text as conversation, not proof that an action ran.',
    ])
    await assertActive()
    await sessionRef.update({ backendModel: model, backendTokensPerGold: tokensPerGold })
    const stream = await interactWithChatStream(messages, model, assistant.temperature, allowedTools, runtime)
    const result = await collectAssistantTextWithToolCalls({
        stream,
        conversationHistory: messages,
        modelKey: model,
        temperatureKey: assistant.temperature,
        allowedTools,
        toolRuntimeContext: runtime,
        localTools,
        assertActive,
        toolExecutor: async (name, args) => {
            await assertActive()
            if (requiresVoiceConfirmation(name)) {
                const pending = (await sessionRef.get()).data()?.livePendingAction
                if (!pending)
                    await sessionRef.update({
                        livePendingAction: { toolName: name, toolArgs: args, requestedAt: Date.now() },
                    })
                return {
                    success: false,
                    status: 'confirmation_required',
                    action: pending || { toolName: name, toolArgs: args },
                    message: 'Ask for explicit approval of this exact action, then use resolve_voice_confirmation.',
                }
            }
            return executeVerified(name, args)
        },
        onRoundComplete: async ({ assistantText, conversation, round }) => {
            const gold = await reconcileLiveUsage({
                sessionId: session.id,
                backend: {
                    id: `${delegationId}:${round}`,
                    model,
                    tokensPerGold,
                    tokens: calculateTokens(assistantText, conversation, model),
                },
            })
            if (gold.insufficientBalance) throw new Error('insufficient_gold')
        },
    })
    return (
        result.finalResponseText ||
        result.assistantResponse ||
        'The assistant returned no answer. Please clarify the request.'
    )
}

module.exports = { runLiveAssistant, isUnambiguousApproval }
