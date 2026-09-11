const crypto = require('crypto')
const admin = require('firebase-admin')
const WebSocket = require('ws')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { getCallSession, updateCallSession, finalizeCallSession, FINAL_STATUSES } = require('./whatsAppCallSessions')
const { storeCallTranscriptTurn } = require('./whatsAppCallTranscript')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { runLiveAssistant } = require('./assistantLiveBackend')
const { createLiveTranscript, LIVE_READY_EVENT } = require('./assistantLiveProtocol')

const keyFor = value => crypto.createHash('sha256').update(value).digest('hex')
const attachUrl = id => `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`
const appendText = text => {
    // A UTF-8 byte bound is conservative for the API's 500-token append limit,
    // including CJK text. The complete backend result remains in the chat.
    let result = ''
    for (const char of String(text || '')) {
        if (Buffer.byteLength(result + char, 'utf8') > 480) break
        result += char
    }
    return result
}

async function closeLiveSession(config, session) {
    if (!session?.openAiSessionId) return
    return new Promise(resolve => {
        const socket = new WebSocket(attachUrl(session.openAiSessionId), {
            headers: { Authorization: `Bearer ${config.openAiApiKey}` },
        })
        let done = false
        let settling = false
        const finish = (finalized = false) => {
            if (!done) {
                done = true
                clearTimeout(timer)
                socket.terminate()
                resolve(finalized)
            }
        }
        const timer = setTimeout(() => finish(), 8000)
        socket.on('error', () => finish())
        socket.on('close', () => {
            if (!settling) finish()
        })
        socket.on('open', () => socket.send(JSON.stringify({ type: 'session.close' })))
        socket.on('message', async data => {
            try {
                const event = JSON.parse(data.toString())
                if (event.type === 'session.closed') {
                    settling = true
                    if (Number.isFinite(event.usage?.seconds))
                        await reconcileLiveUsage({ sessionId: session.id, seconds: event.usage.seconds, final: true })
                    finish(true)
                }
            } catch (_) {
                finish()
            }
        })
    })
}

async function runAssistantLiveCall(sessionId) {
    const config = getWhatsAppCallConfig()
    const session = await getCallSession(sessionId)
    if (!session || FINAL_STATUSES.has(session.status) || !session.openAiSessionId) return
    const ref = admin.firestore().doc(`whatsAppCallSessions/${sessionId}`)
    const claimed = await admin.firestore().runTransaction(async tx => {
        const doc = await tx.get(ref)
        if (doc.data()?.liveControllerClaimedAt || FINAL_STATUSES.has(doc.data()?.status)) return false
        tx.update(ref, { liveControllerClaimedAt: Date.now() })
        return true
    })
    if (!claimed) return
    const transcript = createLiveTranscript()
    const persistedGroups = new Map()
    const pending = new Map()
    const seenDelegations = new Set()
    let socket
    let events = Promise.resolve()
    let backend = null
    let ready = false
    let ending = false
    let finalized = false
    let reason = 'connection_lost'
    let lastUserChangeAt = 0
    let handledRevision = 0
    let tickBusy = false
    let lastControlCheck = 0
    let closeTimer
    let deadlineTimer
    let stopped = false
    const outbox = new Map()

    const send = payload => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
    }
    const append = (type, content, delegationId = null, eventId = crypto.randomUUID()) => {
        const payload = { type, content: appendText(content), delegation_id: delegationId, event_id: eventId }
        outbox.set(eventId, payload)
        send(payload)
    }
    const flushTranscript = async () => {
        for (const group of transcript.messages()) {
            if (persistedGroups.get(group.id) === group.text) continue
            await storeCallTranscriptTurn({
                sessionId,
                turnId: group.id,
                role: group.role,
                text: group.text,
                projectId: session.projectId,
                chatId: session.chatId,
                userId: session.userId,
                assistantId: session.assistantId,
                source: 'browser_call',
                updateExisting: true,
                createdAt: Number(session.startedAt) + group.start,
            })
            persistedGroups.set(group.id, group.text)
        }
    }
    const close = (why, message = '') => {
        if (ending) return
        ending = true
        updateCallSession(sessionId, { controllerConnected: false }).catch(() => {})
        reason = why
        if (message) append('session.instructions.append', message)
        closeTimer = setTimeout(() => send({ type: 'session.close' }), message ? 3500 : 0)
        deadlineTimer = setTimeout(
            () => {
                stopped = true
                socket?.terminate()
            },
            message ? 13500 : 10000
        )
    }
    const assertRevision = async revision => {
        if (ending || stopped || !ready || revision !== transcript.revision) throw new Error('voice_request_superseded')
        if ((await ref.get()).data()?.cancelRequestedAt) {
            close('client_cancelled')
            throw new Error('voice_request_superseded')
        }
        if (ending || stopped || !ready || revision !== transcript.revision) throw new Error('voice_request_superseded')
    }
    const handleEvent = async (event, transcriptChanged) => {
        if (event.client_event_id && event.type.endsWith('.appended')) outbox.delete(event.client_event_id)
        if (event.type === 'error') {
            console.warn('Live Call: Provider rejected event', {
                sessionId,
                code: event.error?.code,
                eventId: event.error?.client_event_id,
            })
            if (event.error?.client_event_id) outbox.delete(event.error.client_event_id)
            close('provider_error', 'The call encountered a connection error and is ending.')
            return
        }
        if (transcriptChanged) {
            await ref
                .collection('liveTranscriptFragments')
                .doc(keyFor(event.event_id))
                .set({
                    role: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant',
                    delta: event.delta,
                    startMs: event.start_ms ?? null,
                    endMs: event.end_ms ?? null,
                })
        }
        if (
            event.type === 'session.delegation.created' &&
            event.delegation?.target === 'client' &&
            event.delegation.id
        ) {
            const id = event.delegation.id
            if (!seenDelegations.has(id)) {
                seenDelegations.add(id)
                pending.set(id, { offset: Number(event.offset_ms) || 0, receivedAt: Date.now() })
            }
        }
        if (event.type === 'session.usage.updated' || event.type === 'session.closed') {
            if (Number.isFinite(event.usage?.seconds)) {
                const gold = await reconcileLiveUsage({
                    sessionId,
                    seconds: event.usage.seconds,
                    final: event.type === 'session.closed',
                })
                if (gold.insufficientBalance || gold.currentGold <= 0)
                    close('insufficient_gold', 'Tell the user their Gold balance is exhausted and the call is ending.')
            }
            if (event.type === 'session.closed') {
                finalized = true
                ending = true
                stopped = true
                reason = event.reason || reason
                await flushTranscript()
                socket?.close()
            }
        }
    }

    const tick = async () => {
        if (tickBusy || stopped) return
        tickBusy = true
        try {
            await events
            if (Date.now() - lastControlCheck >= 2000) {
                lastControlCheck = Date.now()
                if ((await ref.get()).data()?.cancelRequestedAt) close('client_cancelled')
            }
            await flushTranscript()
            if (!ready || ending || backend || !pending.size || Date.now() - lastUserChangeAt < 900) return
            const [delegationId, notice] = pending.entries().next().value
            const userGroups = transcript.messages().filter(group => group.role === 'user')
            const last = userGroups[userGroups.length - 1]
            if (!last || transcript.revision <= handledRevision) {
                if (Date.now() - notice.receivedAt > 6000) {
                    pending.delete(delegationId)
                    append(
                        'session.commentary.append',
                        last
                            ? 'That request has already been handled or is in progress. Ask for a new detail if needed.'
                            : 'I did not receive the request clearly. Please repeat it.',
                        delegationId
                    )
                }
                return
            }
            pending.delete(delegationId)
            const revision = transcript.revision
            const runId = `${delegationId}:${revision}`
            const runRef = ref.collection('liveDelegations').doc(keyFor(runId))
            const runClaimed = await admin.firestore().runTransaction(async tx => {
                const doc = await tx.get(runRef)
                if (doc.exists) return false
                tx.set(runRef, { delegationId, revision, status: 'running', createdAt: Date.now() })
                return true
            })
            if (!runClaimed) return
            handledRevision = revision
            let requestedEnd = false
            backend = runLiveAssistant({
                session,
                delegationId: runId,
                assertActive: () => assertRevision(revision),
                lastUserTurn: { text: last.text, createdAt: last.receivedAt },
                requestEnd: () => {
                    requestedEnd = true
                },
            })
                .then(async result => {
                    await runRef.update({ status: 'completed', result, completedAt: Date.now() })
                    // Full result is durable even when the user interrupts or disconnects.
                    await storeCallTranscriptTurn({
                        sessionId,
                        turnId: runId,
                        role: 'assistant',
                        text: result,
                        projectId: session.projectId,
                        chatId: session.chatId,
                        userId: session.userId,
                        assistantId: session.assistantId,
                        source: 'browser_call_backend',
                        isCallTranscript: false,
                    })
                    if (ending) return
                    if (revision !== transcript.revision) {
                        pending.set(delegationId, { ...notice, receivedAt: Date.now() })
                        return
                    }
                    append('session.commentary.append', result, delegationId)
                    if (requestedEnd)
                        close(
                            'assistant_ended_call',
                            "Give a short warm goodbye in the user's language. The call is ending."
                        )
                })
                .catch(async error => {
                    const superseded = error.message === 'voice_request_superseded'
                    await runRef.update({
                        status: superseded ? 'superseded' : 'failed',
                        error: superseded ? 'request_changed' : 'backend_failed',
                        completedAt: Date.now(),
                    })
                    if (superseded && !ending && transcript.revision > revision)
                        pending.set(delegationId, { ...notice, receivedAt: Date.now() })
                    if (error.message === 'insufficient_gold')
                        close(
                            'insufficient_gold',
                            'Tell the user their Gold balance is exhausted and the call is ending.'
                        )
                    else if (!ending && !superseded)
                        append(
                            'session.commentary.append',
                            'The assistant could not complete the request. Some actions may have completed; check their status before retrying.',
                            delegationId
                        )
                })
                .finally(() => {
                    backend = null
                })
        } finally {
            tickBusy = false
        }
    }
    const interval = setInterval(() => tick().catch(() => close('controller_error')), 300)
    const deadline = setTimeout(
        () => close('max_duration', 'The maximum call duration has been reached. Give a brief goodbye.'),
        Math.max(1000, Number(session.expiresAt) - Date.now() - 30000)
    )
    try {
        for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
            await new Promise(resolve => {
                socket = new WebSocket(attachUrl(session.openAiSessionId), {
                    headers: { Authorization: `Bearer ${config.openAiApiKey}` },
                    handshakeTimeout: 10000,
                })
                socket.on('open', () => {
                    ready = true
                    if (ending) {
                        send({ type: 'session.close' })
                        return
                    }
                    updateCallSession(sessionId, {
                        status: 'controller_running',
                        controllerConnected: true,
                        lastConnectedAt: Date.now(),
                    }).catch(() => close('controller_error'))
                    for (const payload of outbox.values()) send(payload)
                    if (attempt === 0)
                        append(
                            'session.instructions.append',
                            'The application is ready. Greet the user briefly, then listen and delegate their requests.',
                            null,
                            LIVE_READY_EVENT
                        )
                })
                socket.on('message', data => {
                    try {
                        const event = JSON.parse(data.toString())
                        // Invalidate in-flight work at receipt, before any queued
                        // Firestore write can delay processing this correction.
                        const transcriptChanged = transcript.append(event)
                        if (transcriptChanged && event.type === 'session.input_transcript.delta')
                            lastUserChangeAt = Date.now()
                        if (event.type === 'session.closed') ending = true
                        events = events
                            .then(() => handleEvent(event, transcriptChanged))
                            .catch(() => close('event_processing_error'))
                    } catch (_) {
                        close('event_processing_error')
                    }
                })
                socket.on('error', () => {
                    ready = false
                    close('connection_lost')
                    socket.terminate()
                    resolve()
                })
                socket.on('close', () => {
                    ready = false
                    // Sideband reconnect has no transcript replay guarantee. Reattach
                    // only to close and settle, never execute against missing speech.
                    if (!stopped) close('connection_lost')
                    resolve()
                })
            })
            await events
            if (!stopped) await new Promise(resolve => setTimeout(resolve, 1000))
        }
    } finally {
        ending = true
        stopped = true
        clearInterval(interval)
        clearTimeout(deadline)
        clearTimeout(closeTimer)
        clearTimeout(deadlineTimer)
        if (!finalized) finalized = await closeLiveSession(config, session)
        socket?.terminate()
        await events
        // Existing tool calls may complete, but assertActive prevents further actions.
        if (backend) await backend
        await flushTranscript()
        await updateCallSession(sessionId, {
            livePendingAction: null,
            recapStatus: 'skipped',
            controllerConnected: false,
        })
        await finalizeCallSession(sessionId, reason, finalized ? 'completed' : 'failed')
    }
}

module.exports = { runAssistantLiveCall, closeLiveSession, appendText }
