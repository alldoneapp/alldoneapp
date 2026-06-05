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
        gold_required: 'You need a positive Gold balance before starting an assistant call.',
        missing_project: 'Set a default project before calling the assistant.',
        missing_assistant: 'No default assistant is available for your call.',
        missing_topic: 'Create a voice call topic before calling the assistant.',
        invalid_topic: 'The selected voice call topic is not available.',
        active_call: 'You already have an active assistant call.',
        configuration: 'Browser assistant calls are temporarily unavailable because setup is incomplete.',
    }
    return new HttpsError(code, messages[reason] || 'The assistant call could not be started.')
}

function getLocationCallId(location) {
    const normalized = String(location || '').trim()
    if (!normalized) return ''
    return normalized.split('/').filter(Boolean).pop() || ''
}

function buildInitialBrowserRealtimeSession({ config, voice }) {
    return {
        type: 'realtime',
        model: config.realtimeModel,
        audio: {
            output: { voice },
        },
    }
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
    const form = new FormData()
    form.set('sdp', offerSdp)
    form.set('session', JSON.stringify(buildInitialBrowserRealtimeSession({ config, voice, language })))

    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.openAiApiKey}`,
            'OpenAI-Safety-Identifier': getSafetyIdentifier(userId),
        },
        body: form,
    })
    const answerSdp = await response.text()
    if (!response.ok) {
        const error = new Error(`OpenAI WebRTC call failed with HTTP ${response.status}`)
        error.status = response.status
        error.code = getOpenAICallErrorCode(answerSdp)
        throw error
    }

    return {
        answerSdp,
        openAiCallId: getLocationCallId(response.headers.get('location')),
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
    })
    if (!leaseResult.success) throw getHttpsErrorForEligibility(leaseResult.reason || 'active_call')

    try {
        const assistant = await getAssistantForChat(projectId, assistantId, userId)
        const { answerSdp, openAiCallId, voice } = await createOpenAIWebRTCSession({
            config,
            offerSdp,
            assistant,
            language: user.language,
            userId,
        })
        if (!openAiCallId) throw createMissingOpenAICallIdError()

        await updateCallSession(sessionId, {
            openAiCallId,
            realtimeVoice: voice,
            status: 'accepted',
            startedAt: Date.now(),
            acceptCompletedAt: Date.now(),
        })
        await enqueueBrowserCallController(sessionId)
        await updateCallSession(sessionId, { status: 'controller_queued' })

        return {
            sessionId,
            projectId,
            chatId,
            assistantId,
            answerSdp,
        }
    } catch (error) {
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

module.exports = {
    buildInitialBrowserRealtimeSession,
    createMissingOpenAICallIdError,
    createOpenAIWebRTCSession,
    resolveBrowserCallTopic,
    startAssistantBrowserCall,
}
