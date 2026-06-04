const admin = require('firebase-admin')
const twilio = require('twilio')
const { PLAN_STATUS_PREMIUM } = require('../Payment/premiumHelper')
const TwilioWhatsAppService = require('../Services/TwilioWhatsAppService')
const { getOrCreateWhatsAppDailyTopic } = require('./whatsAppDailyTopic')
const { findUserByPhone, getDefaultAssistantId, normalizePhoneNumber } = require('./whatsAppIncomingHandler')
const { createRoutingToken } = require('./whatsAppCallSecurity')
const { getSafeCallErrorDetails } = require('./whatsAppCallPrivacy')
const { createCallSessionWithLease, finalizeCallSession, updateCallSession } = require('./whatsAppCallSessions')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')

const TERMINAL_TWILIO_STATUSES = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled'])

function getCallEligibilityReason({ config, user }) {
    if (!config.enabled) return 'disabled'
    if (!user) return 'unlinked'
    if (user?.premium?.status !== PLAN_STATUS_PREMIUM) return 'premium_required'
    if ((Number(user.gold) || 0) <= 0) return 'gold_required'
    if (!user.defaultProjectId) return 'missing_project'
    return null
}

function getRejectionMessage(reason) {
    const messages = {
        disabled: 'WhatsApp assistant calls are not available right now. You can still message the assistant here.',
        unlinked:
            'This number is not linked to an Alldone account. Add your WhatsApp number in Alldone settings first.',
        premium_required: 'WhatsApp assistant calls are available to premium Alldone users.',
        gold_required: 'You need a positive Gold balance before starting a WhatsApp assistant call.',
        missing_project: 'Set a default project in Alldone before calling the assistant.',
        missing_assistant: 'No default assistant is available for your WhatsApp call.',
        active_call: 'You already have an active assistant call. End it before starting another one.',
        configuration: 'WhatsApp assistant calls are temporarily unavailable because setup is incomplete.',
    }
    return messages[reason] || 'The assistant could not accept this WhatsApp call. Please try again later.'
}

async function rejectCall(res, fromNumber, reason) {
    const service = new TwilioWhatsAppService()
    await service
        .sendWhatsAppMessage(fromNumber, getRejectionMessage(reason), { suppressSensitiveLogging: true })
        .catch(error => {
            console.warn('WhatsApp Call: Failed sending rejection message', {
                reason,
                error: getSafeCallErrorDetails(error),
            })
        })
    const response = new twilio.twiml.VoiceResponse()
    response.reject({ reason: 'busy' })
    res.type('text/xml').status(200).send(response.toString())
}

function validateTwilioRequest(req, webhookUrl) {
    const signature = req.headers['x-twilio-signature']
    if (!signature) return false
    return new TwilioWhatsAppService().validateWebhookSignature(signature, webhookUrl, req.body)
}

function buildSipTwiML({ openAiProjectId, routingToken, statusCallbackUrl }) {
    const sipUri =
        `sip:${encodeURIComponent(openAiProjectId)}@sip.api.openai.com;transport=tls` +
        `?x-alldone-route=${encodeURIComponent(routingToken)}`
    const response = new twilio.twiml.VoiceResponse()
    const dial = response.dial({
        answerOnBridge: true,
        timeout: 25,
        action: statusCallbackUrl,
        method: 'POST',
    })
    dial.sip(
        {
            statusCallback: statusCallbackUrl,
            statusCallbackMethod: 'POST',
            statusCallbackEvent: 'initiated ringing answered completed',
        },
        sipUri
    )
    return response.toString()
}

async function handleIncomingWhatsAppCall(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

    const config = getWhatsAppCallConfig()
    if (!validateTwilioRequest(req, config.twilioIncomingCallUrl)) {
        console.warn('WhatsApp Call: Invalid Twilio signature')
        return res.status(403).send('Forbidden')
    }

    const fromNumber = req.body?.From
    const twilioCallSid = String(req.body?.CallSid || '').trim()
    if (!twilioCallSid || !fromNumber) return res.status(400).send('Missing call data')

    const userId = await findUserByPhone(normalizePhoneNumber(fromNumber))
    const userDoc = userId ? await admin.firestore().doc(`users/${userId}`).get() : null
    const user = userDoc?.exists ? { ...userDoc.data(), uid: userDoc.id } : null
    const eligibilityReason = getCallEligibilityReason({ config, user })
    if (eligibilityReason) return rejectCall(res, fromNumber, eligibilityReason)

    if (!config.openAiApiKey || !config.openAiProjectId || !config.routingTokenSecret || !config.openAiWebhookSecret) {
        return rejectCall(res, fromNumber, 'configuration')
    }

    const projectId = user.defaultProjectId
    const assistantId = await getDefaultAssistantId(user, projectId)
    if (!assistantId) return rejectCall(res, fromNumber, 'missing_assistant')

    const { chatId } = await getOrCreateWhatsAppDailyTopic(userId, projectId, assistantId, user)
    const routingToken = createRoutingToken(twilioCallSid, config.routingTokenSecret)
    const now = Date.now()
    const leaseResult = await createCallSessionWithLease({
        sessionId: twilioCallSid,
        routingToken,
        routingSecret: config.routingTokenSecret,
        routeExpiresAt: now + config.routeTokenTtlMs,
        leaseExpiresAt: now + config.callLeaseMs,
        sessionExpiresAt: now + config.maxDurationSeconds * 1000,
        userId,
        projectId,
        assistantId,
        chatId,
        twilioCallSid,
        language: user.language,
    })
    if (!leaseResult.success) return rejectCall(res, fromNumber, leaseResult.reason || 'active_call')

    console.log('WhatsApp Call: Routed eligible call', {
        sessionId: twilioCallSid,
        userId,
        projectId,
        assistantId,
    })
    return res
        .type('text/xml')
        .status(200)
        .send(
            buildSipTwiML({
                openAiProjectId: config.openAiProjectId,
                routingToken,
                statusCallbackUrl: config.twilioStatusCallbackUrl,
            })
        )
}

async function handleWhatsAppCallStatus(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed')

    const config = getWhatsAppCallConfig()
    if (!validateTwilioRequest(req, config.twilioStatusCallbackUrl)) {
        console.warn('WhatsApp Call Status: Invalid Twilio signature')
        return res.status(403).send('Forbidden')
    }

    const sessionId = String(req.body?.ParentCallSid || req.body?.CallSid || '').trim()
    const callStatus = String(req.body?.DialCallStatus || req.body?.CallStatus || '').trim()
    const sendAcknowledgement = () => {
        const response = new twilio.twiml.VoiceResponse()
        return res.type('text/xml').status(200).send(response.toString())
    }
    if (!sessionId) return sendAcknowledgement()

    if (TERMINAL_TWILIO_STATUSES.has(callStatus)) {
        await finalizeCallSession(
            sessionId,
            `twilio_${callStatus}`,
            callStatus === 'completed' ? 'completed' : 'failed'
        )
    } else {
        await updateCallSession(sessionId, { twilioStatus: callStatus })
    }
    return sendAcknowledgement()
}

module.exports = {
    buildSipTwiML,
    getCallEligibilityReason,
    getRejectionMessage,
    handleIncomingWhatsAppCall,
    handleWhatsAppCallStatus,
    validateTwilioRequest,
}
