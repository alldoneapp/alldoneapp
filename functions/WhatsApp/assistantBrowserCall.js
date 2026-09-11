const crypto = require('crypto')
const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')
const { HttpsError } = require('firebase-functions/v2/https')
const { v4: uuidv4 } = require('uuid')
const { getAssistantForChat } = require('../Assistant/assistantHelper')
const { getDefaultAssistantId } = require('./whatsAppIncomingHandler')
const { getCallEligibilityReason } = require('./whatsAppCallTwilioWebhook')
const { getWhatsAppCallConfig, normalizeRealtimeVoice } = require('./whatsAppCallConfig')
const { getRunCallQueueResource, getRunCallTaskId } = require('./whatsAppCallOpenAIWebhook')
const { getSafeCallErrorDetails } = require('./whatsAppCallPrivacy')
const { buildLiveSession } = require('./assistantLiveProtocol')
const {
    LIVE_MODEL,
    LIVE_GOLD_PER_MINUTE,
    LIVE_INITIALIZATION_SECONDS,
    calculateLiveVoiceGold,
} = require('./assistantLivePricing')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { createDirectCallSessionWithLease, finalizeCallSession, updateCallSession } = require('./whatsAppCallSessions')

const MAX_SDP_LENGTH = 200000

function getSafetyIdentifier(userId) {
    return crypto
        .createHash('sha256')
        .update(String(userId || ''))
        .digest('hex')
}

function getHttpsErrorForEligibility(reason) {
    const code = reason === 'disabled' || reason === 'configuration' ? 'unavailable' : 'failed-precondition'
    const messages = {
        disabled: 'Browser assistant calls are not available right now.',
        unlinked: 'You must be signed in to call the assistant.',
        premium_required: 'Browser assistant calls are available to premium Alldone users.',
        gold_required: `You need more than ${calculateLiveVoiceGold(LIVE_INITIALIZATION_SECONDS)} Gold to start a voice call (the ${LIVE_INITIALIZATION_SECONDS}-second voice minimum plus assistant usage).`,
        missing_project: 'Set a default project before calling the assistant.',
        missing_assistant: 'No default assistant is available for your call.',
        missing_topic: 'Create a voice call topic before calling the assistant.',
        invalid_topic: 'The selected voice call topic is not available.',
        active_call: 'You already have an active assistant call.',
        configuration: 'Browser assistant calls are temporarily unavailable because setup is incomplete.',
    }
    return new HttpsError(code, messages[reason] || 'The assistant call could not be started.')
}

function buildInitialBrowserLiveSession({ voice, assistant, language }) {
    return buildLiveSession({ assistant, language, voice })
}

function getOpenAICallErrorCode(responseBody) {
    try {
        const parsed = JSON.parse(responseBody)
        return String(parsed?.error?.code || parsed?.error?.type || '').slice(0, 120)
    } catch (_) {
        return ''
    }
}

function createMissingOpenAICallIdError() {
    const error = new Error('OpenAI WebRTC call did not return a call id')
    error.code = 'missing_openai_call_id'
    return error
}

function safeString(value) {
    return String(value || '').trim()
}

function userCanUseChat(userId, chat) {
    if (!chat) return false
    if (chat.creatorId === userId || chat.lastEditorId === userId) return true
    if (Array.isArray(chat.members) && chat.members.includes(userId)) return true
    if (Array.isArray(chat.usersFollowing) && chat.usersFollowing.includes(userId)) return true
    return false
}

async function resolveBrowserCallTopic(data, user, userId) {
    const projectId = safeString(data?.projectId) || safeString(user.defaultProjectId)
    const chatId = safeString(data?.chatId)
    if (!projectId) throw getHttpsErrorForEligibility('missing_project')
    if (!chatId) throw getHttpsErrorForEligibility('missing_topic')

    const assistantId = safeString(data?.assistantId) || (await getDefaultAssistantId(user, projectId))
    if (!assistantId) throw getHttpsErrorForEligibility('missing_assistant')

    const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${chatId}`).get()
    if (!chatDoc.exists) throw getHttpsErrorForEligibility('invalid_topic')

    const chat = chatDoc.data() || {}
    if (chat.type !== 'topics') throw getHttpsErrorForEligibility('invalid_topic')
    if (chat.assistantId && chat.assistantId !== assistantId) throw getHttpsErrorForEligibility('invalid_topic')
    if (!userCanUseChat(userId, chat)) throw getHttpsErrorForEligibility('invalid_topic')

    return { projectId, chatId, assistantId }
}

async function createOpenAIWebRTCSession({ config, offerSdp, assistant, language, userId }) {
    const voice = normalizeRealtimeVoice(assistant?.realtimeVoice)
    const response = await fetch('https://api.openai.com/v1/live/sessions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.openAiApiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Safety-Identifier': getSafetyIdentifier(userId),
        },
        body: JSON.stringify({
            session: buildInitialBrowserLiveSession({ voice, assistant, language }),
            transport: { type: 'webrtc', sdp: offerSdp },
        }),
        signal: AbortSignal.timeout(25000),
    })
    const responseText = await response.text()
    if (!response.ok) {
        const error = new Error(`OpenAI WebRTC call failed with HTTP ${response.status}`)
        error.status = response.status
        error.code = getOpenAICallErrorCode(responseText)
        throw error
    }
    const result = JSON.parse(responseText)
    if (!result.session?.id || !result.transport?.sdp) {
        const error = createMissingOpenAICallIdError()
        error.openAiSessionId = result.session?.id
        throw error
    }
    return {
        answerSdp: result.transport.sdp,
        openAiSessionId: result.session.id,
        voice,
    }
}

async function enqueueBrowserCallController(sessionId) {
    try {
        await getFunctions()
            .taskQueue(getRunCallQueueResource())
            .enqueue({ sessionId }, { id: getRunCallTaskId(sessionId), dispatchDeadlineSeconds: 1800 })
    } catch (error) {
        if (error?.code !== 'functions/task-already-exists') throw error
    }
}

async function startAssistantBrowserCall(data, auth) {
    const userId = auth?.uid
    if (!userId) throw new HttpsError('unauthenticated', 'Sign in before calling the assistant.')
    if (data?.voiceProtocol !== 'gpt-live-v2')
        throw new HttpsError('failed-precondition', 'Refresh Alldone to use the updated voice calls.')

    const offerSdp = String(data?.offerSdp || data?.sdp || '')
    if (!offerSdp.trim() || offerSdp.length > MAX_SDP_LENGTH) {
        throw new HttpsError('invalid-argument', 'A valid WebRTC SDP offer is required.')
    }

    const config = getWhatsAppCallConfig()
    const userDoc = await admin.firestore().doc(`users/${userId}`).get()
    const user = userDoc.exists ? { ...userDoc.data(), uid: userDoc.id } : null
    const eligibilityReason = getCallEligibilityReason({
        config: { ...config, enabled: config.browserCallsEnabled },
        user,
    })
    if (eligibilityReason) throw getHttpsErrorForEligibility(eligibilityReason)
    if (!config.openAiApiKey) throw getHttpsErrorForEligibility('configuration')
    if (Number(user.gold) <= calculateLiveVoiceGold(LIVE_INITIALIZATION_SECONDS))
        throw getHttpsErrorForEligibility('gold_required')

    const { projectId, chatId, assistantId } = await resolveBrowserCallTopic(data, user, userId)
    const sessionId = `browser-${uuidv4()}`
    const now = Date.now()
    const leaseResult = await createDirectCallSessionWithLease({
        sessionId,
        leaseExpiresAt: now + config.callLeaseMs,
        sessionExpiresAt: now + config.maxDurationSeconds * 1000,
        userId,
        projectId,
        assistantId,
        chatId,
        language: user.language,
        channel: 'browser_call',
        realtimeModel: '',
    })
    if (!leaseResult.success) throw getHttpsErrorForEligibility(leaseResult.reason || 'active_call')

    let openAiSessionId
    try {
        await updateCallSession(sessionId, {
            voiceProvider: 'gpt-live',
            voiceModel: LIVE_MODEL,
            voiceGoldPerMinute: LIVE_GOLD_PER_MINUTE,
            voiceSeconds: 0,
            voiceBilledGold: 0,
            backendBilledGold: 0,
            backendTokens: 0,
            voiceUsageFinal: false,
            controllerConnected: false,
        })
        const assistant = await getAssistantForChat(projectId, assistantId, userId)
        const result = await createOpenAIWebRTCSession({
            config,
            offerSdp,
            assistant,
            language: user.language,
            userId,
        })
        const { answerSdp, voice } = result
        openAiSessionId = result.openAiSessionId

        await updateCallSession(sessionId, {
            openAiSessionId,
            realtimeVoice: voice,
            status: 'accepted',
            startedAt: Date.now(),
            acceptCompletedAt: Date.now(),
        })
        const gold = await reconcileLiveUsage({ sessionId, seconds: LIVE_INITIALIZATION_SECONDS })
        if (gold.insufficientBalance || gold.currentGold <= 0) throw getHttpsErrorForEligibility('gold_required')
        await enqueueBrowserCallController(sessionId)
        await updateCallSession(sessionId, { status: 'controller_queued' })

        return {
            sessionId,
            projectId,
            chatId,
            assistantId,
            answerSdp,
            voiceProvider: 'gpt-live',
            voiceGoldPerMinute: LIVE_GOLD_PER_MINUTE,
        }
    } catch (error) {
        openAiSessionId = openAiSessionId || error.openAiSessionId
        if (openAiSessionId) {
            const { closeLiveSession } = require('./assistantLiveController')
            await closeLiveSession(config, { id: sessionId, openAiSessionId }).catch(() => {})
        }
        console.error('Browser Call: Failed starting call', {
            sessionId,
            userId,
            error: getSafeCallErrorDetails(error),
        })
        await finalizeCallSession(sessionId, 'browser_start_failed', 'failed').catch(() => {})
        if (error instanceof HttpsError) throw error
        throw new HttpsError('internal', 'The browser assistant call could not be started.')
    }
}

async function getAssistantBrowserCallSummary(data, auth) {
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to view call usage.')
    const sessionId = String(data?.sessionId || '')
    if (!/^browser-[a-zA-Z0-9-]+$/.test(sessionId)) throw new HttpsError('invalid-argument', 'Invalid call id.')
    const doc = await admin.firestore().doc(`whatsAppCallSessions/${sessionId}`).get()
    if (!doc.exists || doc.data()?.userId !== auth.uid) throw new HttpsError('not-found', 'Call not found.')
    const session = doc.data()
    return {
        voiceGold: Number(session.voiceBilledGold || 0),
        assistantGold: Number(session.backendBilledGold || 0),
        settled: ['completed', 'failed', 'cancelled', 'stale'].includes(session.status),
        finalVoiceUsage: session.voiceUsageFinal === true,
        controllerConnected:
            session.controllerConnected === true &&
            !session.cancelRequestedAt &&
            !['completed', 'failed', 'cancelled', 'stale'].includes(session.status),
    }
}

// Close a paid provider session when the browser fails or leaves during startup.
// IDs alone confer no authority; this is restricted to the call's owner.
async function endAssistantBrowserCall(data, auth) {
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to end a call.')
    const sessionId = String(data?.sessionId || '')
    if (!/^browser-[a-zA-Z0-9-]+$/.test(sessionId)) throw new HttpsError('invalid-argument', 'Invalid call id.')
    const ref = admin.firestore().doc(`whatsAppCallSessions/${sessionId}`)
    const doc = await ref.get()
    const session = doc.data()
    if (!doc.exists || session?.userId !== auth.uid) throw new HttpsError('not-found', 'Call not found.')
    if (['completed', 'failed', 'cancelled', 'stale'].includes(session.status)) return { closed: true }
    if (session.voiceProvider !== 'gpt-live') throw new HttpsError('failed-precondition', 'Unsupported call.')
    await ref.update({ cancelRequestedAt: Date.now(), controllerConnected: false })
    const { closeLiveSession } = require('./assistantLiveController')
    const closed = await closeLiveSession(getWhatsAppCallConfig(), { ...session, id: sessionId }).catch(() => false)
    // An active controller settles only after its in-flight assistant work finishes.
    if (closed && !session.liveControllerClaimedAt)
        await finalizeCallSession(sessionId, 'client_cancelled', 'completed')
    return { closed: !!closed }
}

module.exports = {
    buildInitialBrowserLiveSession,
    createMissingOpenAICallIdError,
    createOpenAIWebRTCSession,
    resolveBrowserCallTopic,
    startAssistantBrowserCall,
    getAssistantBrowserCallSummary,
    endAssistantBrowserCall,
}
