const crypto = require('crypto')
const { getFunctions } = require('firebase-admin/functions')
const { getAssistantForChat } = require('../Assistant/assistantHelper')
const { REGION, getWhatsAppCallConfig, normalizeRealtimeVoice } = require('./whatsAppCallConfig')
const {
    extractRoutingTokenFromSipHeaders,
    getRawRequestBody,
    verifyOpenAIWebhookSignature,
} = require('./whatsAppCallSecurity')
const {
    FINAL_STATUSES,
    consumeRoutingToken,
    finalizeCallSession,
    updateCallSession,
} = require('./whatsAppCallSessions')
const { getSafeCallErrorDetails } = require('./whatsAppCallPrivacy')
const { buildCallBootstrapInstructions } = require('./whatsAppCallPrompt')

const RUN_CALL_FUNCTION_NAME = 'runWhatsAppRealtimeCall'

function getRunCallQueueResource() {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    return projectId ? `locations/${REGION}/functions/${RUN_CALL_FUNCTION_NAME}` : RUN_CALL_FUNCTION_NAME
}

function getRunCallTaskId(sessionId) {
    return `whatsapp-call-${crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 40)}`
}

function buildInitialRealtimeSession({ config, voice, assistant, language }) {
    return {
        type: 'realtime',
        model: config.realtimeModel,
        output_modalities: ['audio'],
        instructions: buildCallBootstrapInstructions(assistant, language),
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
            output: { voice },
        },
    }
}

async function openAiCallRequest(config, callId, method, body, action = '') {
    const suffix = action ? `/${action}` : ''
    const response = await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}${suffix}`, {
        method,
        headers: {
            Authorization: `Bearer ${config.openAiApiKey}`,
            'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI call ${method} failed with HTTP ${response.status}: ${errorText.slice(0, 240)}`)
    }
}

async function handleOpenAIRealtimeCallWebhook(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

    const config = getWhatsAppCallConfig()
    const rawBody = getRawRequestBody(req)
    const signatureValid = verifyOpenAIWebhookSignature({
        rawBody,
        webhookId: req.headers['webhook-id'],
        webhookTimestamp: req.headers['webhook-timestamp'],
        webhookSignature: req.headers['webhook-signature'],
        secret: config.openAiWebhookSecret,
    })
    if (!signatureValid) {
        console.warn('WhatsApp Call OpenAI webhook: Invalid signature')
        return res.status(403).send('Forbidden')
    }

    let event
    try {
        event = JSON.parse(rawBody)
    } catch (_) {
        return res.status(400).send('Invalid JSON')
    }
    if (event.type !== 'realtime.call.incoming') return res.status(200).send('Ignored')

    const callId = String(event.data?.call_id || event.data?.callId || '').trim()
    const routingToken = extractRoutingTokenFromSipHeaders(event.data || {})
    if (!callId) return res.status(200).send('Ignored')
    if (!routingToken || !config.routingTokenSecret) {
        if (config.openAiApiKey) {
            await openAiCallRequest(config, callId, 'POST', { status_code: 486 }, 'reject').catch(() => {})
        }
        return res.status(200).send('Ignored')
    }

    const consumed = await consumeRoutingToken({
        routingToken,
        routingSecret: config.routingTokenSecret,
        openAiCallId: callId,
    })
    if (!consumed.success) {
        console.warn('WhatsApp Call OpenAI webhook: Route rejected', { reason: consumed.reason })
        if (config.openAiApiKey) {
            await openAiCallRequest(config, callId, 'POST', { status_code: 486 }, 'reject').catch(() => {})
        }
        return res.status(200).send('Ignored')
    }

    const session = consumed.session || {}
    if (
        consumed.duplicate &&
        (FINAL_STATUSES.has(session.status) || ['controller_queued', 'controller_running'].includes(session.status))
    ) {
        return res.status(200).send('OK')
    }

    try {
        const assistant = await getAssistantForChat(session.projectId, session.assistantId, session.userId)
        const voice = normalizeRealtimeVoice(assistant?.realtimeVoice)
        if (!session.acceptCompletedAt) {
            try {
                await openAiCallRequest(
                    config,
                    callId,
                    'POST',
                    buildInitialRealtimeSession({ config, voice, assistant, language: session.language }),
                    'accept'
                )
                await updateCallSession(consumed.sessionId, { acceptCompletedAt: Date.now() })
            } catch (error) {
                if (!consumed.duplicate) throw error
                console.warn('WhatsApp Call OpenAI webhook: Duplicate accept could not be confirmed', {
                    sessionId: consumed.sessionId,
                    error: getSafeCallErrorDetails(error),
                })
            }
        }
        try {
            await getFunctions()
                .taskQueue(getRunCallQueueResource())
                .enqueue(
                    { sessionId: consumed.sessionId },
                    { id: getRunCallTaskId(consumed.sessionId), dispatchDeadlineSeconds: 1800 }
                )
        } catch (error) {
            if (error?.code !== 'functions/task-already-exists') throw error
        }
        await updateCallSession(consumed.sessionId, { status: 'controller_queued', realtimeVoice: voice })
        console.log('WhatsApp Call OpenAI webhook: Accepted and queued', {
            sessionId: consumed.sessionId,
            userId: session.userId,
            projectId: session.projectId,
            assistantId: session.assistantId,
        })
    } catch (error) {
        console.error('WhatsApp Call OpenAI webhook: Failed accepting call', {
            sessionId: consumed.sessionId,
            error: getSafeCallErrorDetails(error),
        })
        await openAiCallRequest(config, callId, 'POST', null, 'hangup').catch(() => {})
        await finalizeCallSession(consumed.sessionId, 'openai_accept_failed', 'failed')
        const { sendCallRecap } = require('./whatsAppCallController')
        await sendCallRecap(consumed.sessionId).catch(() => {})
    }

    return res.status(200).send('OK')
}

module.exports = {
    buildInitialRealtimeSession,
    getRunCallTaskId,
    handleOpenAIRealtimeCallWebhook,
    openAiCallRequest,
}
