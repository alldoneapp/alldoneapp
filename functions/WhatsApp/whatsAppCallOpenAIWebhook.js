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
const { buildLiveSession } = require('./assistantLiveProtocol')
const { LIVE_SIP_SETUP, getLiveConfigurationError, getLiveSessionDefaults } = require('./assistantLiveConfig')
const { LIVE_INITIALIZATION_SECONDS } = require('./assistantLivePricing')
const { reconcileLiveUsage } = require('./assistantLiveGold')

const RUN_CALL_FUNCTION_NAME = 'runWhatsAppRealtimeCall'
// `live.call.incoming` is the deprecated name; OpenAI may still deliver it while
// the webhook subscription migrates, so both are accepted.
const LIVE_INCOMING_EVENTS = new Set(['live.transport.incoming', 'live.call.incoming'])

function getRunCallQueueResource() {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    return projectId ? `locations/${REGION}/functions/${RUN_CALL_FUNCTION_NAME}` : RUN_CALL_FUNCTION_NAME
}

function getRunCallTaskId(sessionId) {
    return `whatsapp-call-${crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 40)}`
}

async function liveSessionRequest(config, liveSessionId, action, body) {
    const response = await fetch(
        `https://api.openai.com/v1/live/sessions/${encodeURIComponent(liveSessionId)}/${action}`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.openAiApiKey}`,
                'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        }
    )
    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI Live ${action} failed with HTTP ${response.status}: ${errorText.slice(0, 240)}`)
    }
}

async function enqueueCallController(sessionId) {
    try {
        await getFunctions()
            .taskQueue(getRunCallQueueResource())
            .enqueue({ sessionId }, { id: getRunCallTaskId(sessionId), dispatchDeadlineSeconds: 1800 })
    } catch (error) {
        if (error?.code !== 'functions/task-already-exists') throw error
    }
}

// Phone and WhatsApp calls reach OpenAI over SIP and are answered as GPT-Live
// sessions, handled by the same controller, prompt and pricing as in-app calls.
async function handleLiveSipCall(config, event, res) {
    const data = event.data || {}
    if (data.type && data.type !== 'sip') return res.status(200).send('Ignored')
    const liveSessionId = String(data.session_id || data.sessionId || '').trim()
    const routingToken = extractRoutingTokenFromSipHeaders(data)
    if (!liveSessionId) return res.status(200).send('Ignored')
    const reject = () =>
        config.openAiApiKey
            ? liveSessionRequest(config, liveSessionId, 'reject', { status_code: 486 }).catch(() => {})
            : null
    const configurationError = getLiveConfigurationError(config, { sip: true })
    if (configurationError) {
        console.error('Live SIP Call: Configuration unavailable', {
            code: 'gpt_live_configuration',
            action: configurationError,
        })
        await reject()
        return res.status(503).send(configurationError)
    }

    if (!routingToken) {
        await reject()
        return res.status(200).send('Ignored')
    }

    const consumed = await consumeRoutingToken({
        routingToken,
        routingSecret: config.routingTokenSecret,
        openAiCallId: liveSessionId,
    })
    if (!consumed.success) {
        console.warn('Live SIP Call: Route rejected', { reason: consumed.reason })
        // A route already consumed under another id means this SIP call is being
        // handled already; rejecting here could tear down the live leg.
        if (consumed.reason !== 'replayed_route') await reject()
        return res.status(200).send('Ignored')
    }

    const session = consumed.session || {}
    if (
        consumed.duplicate &&
        (FINAL_STATUSES.has(session.status) || ['controller_queued', 'controller_running'].includes(session.status))
    ) {
        return res.status(200).send('OK')
    }

    const sessionId = consumed.sessionId
    try {
        const assistant = await getAssistantForChat(session.projectId, session.assistantId, session.userId)
        const voice = normalizeRealtimeVoice(assistant?.realtimeVoice)
        // Defaults are frozen when the route is created. Do not reset a retry's ledger.
        await updateCallSession(sessionId, {
            ...(!session.voiceProvider ? getLiveSessionDefaults() : {}),
            openAiSessionId: liveSessionId,
        })
        if (!session.acceptCompletedAt) {
            await liveSessionRequest(config, liveSessionId, 'accept', {
                session: {
                    type: 'live',
                    ...buildLiveSession({ assistant, language: session.language, voice, channel: session.channel }),
                },
            })
            await updateCallSession(sessionId, { acceptCompletedAt: Date.now() })
        }
        // Cumulative, so a webhook retry cannot charge the minimum twice.
        const gold = await reconcileLiveUsage({ sessionId, seconds: LIVE_INITIALIZATION_SECONDS })
        if (gold.insufficientBalance || gold.currentGold <= 0) throw new Error('insufficient_gold')
        await enqueueCallController(sessionId)
        await updateCallSession(sessionId, { status: 'controller_queued', realtimeVoice: voice })
        console.log('Live SIP Call: Accepted and queued', {
            sessionId,
            channel: session.channel,
            userId: session.userId,
            projectId: session.projectId,
            assistantId: session.assistantId,
        })
    } catch (error) {
        console.error('Live SIP Call: Failed accepting call', {
            sessionId,
            error: getSafeCallErrorDetails(error),
            action: LIVE_SIP_SETUP,
        })
        await updateCallSession(sessionId, {
            lastError: 'gpt_live_accept_failed',
            configurationAction: LIVE_SIP_SETUP,
        }).catch(() => {})
        await liveSessionRequest(config, liveSessionId, 'hangup').catch(() => {})
        await finalizeCallSession(sessionId, 'openai_accept_failed', 'failed')
        const { sendCallRecap } = require('./whatsAppCallController')
        await sendCallRecap(sessionId).catch(() => {})
    }

    return res.status(200).send('OK')
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
    if (LIVE_INCOMING_EVENTS.has(event.type)) return handleLiveSipCall(config, event, res)
    if (event.type !== 'realtime.call.incoming') return res.status(200).send('Ignored')
    // One pending SIP call can emit both event families. Only Live owns the
    // accept/reject decision: never consume its route or reject the shared leg here.
    console.error('Live SIP Call: Legacy Realtime event ignored; GPT-Live is required', {
        code: 'gpt_live_sip_subscription_required',
        action: LIVE_SIP_SETUP,
    })
    return res.status(200).send('Ignored: GPT-Live required; configure live.transport.incoming')
}

module.exports = {
    getRunCallQueueResource,
    getRunCallTaskId,
    handleLiveSipCall,
    handleOpenAIRealtimeCallWebhook,
    liveSessionRequest,
}
