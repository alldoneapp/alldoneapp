const crypto = require('crypto')
const admin = require('firebase-admin')
const WebSocket = require('ws')
const { getWhatsAppCallConfig } = require('./whatsAppCallConfig')
const { getCallSession, updateCallSession, finalizeCallSession, FINAL_STATUSES } = require('./whatsAppCallSessions')
const { storeCallTranscriptTurn } = require('./whatsAppCallTranscript')
const { reconcileLiveUsage } = require('./assistantLiveGold')
const { runLiveAssistant } = require('./assistantLiveBackend')
const { createLiveTranscript, LIVE_READY_EVENT } = require('./assistantLiveProtocol')
const { createLiveProgress, backgroundProgress, voiceToolFailure } = require('./assistantLiveProgress')
const { createLiveAnswerDelivery } = require('./assistantLiveAnswerDelivery')

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
    let progress = null
    let answerDelivery = null
    let answerRevision = 0
    let deliveryWrites = Promise.resolve()
    let ready = false
    let ending = false
    let finalized = false
    let reason = 'connection_lost'
    let lastUserChangeAt = 0
    let lastSpeechAt = 0
    let lastProgressAt = 0
    const backgroundJobs = new Map()
    let handledRevision = 0
    let tickBusy = false
    let lastControlCheck = 0
    let closeTimer
    let deadlineTimer
    let stopped = false
    const outbox = new Map()

    const send = payload => {
        if (socket?.readyState !== WebSocket.OPEN) return false
        socket.send(JSON.stringify(payload))
        return true
    }
    const append = (type, content, delegationId = null, eventId = crypto.randomUUID()) => {
        const payload = { type, content: appendText(content), delegation_id: delegationId, event_id: eventId }
        outbox.set(eventId, payload)
        const sent = send(payload)
        if (eventId.startsWith('alldone_live_answer_'))
            console.info('Live Call: Answer append', { sessionId, eventId, delegationId, type, sent, at: Date.now() })
    }
    const publishProgress = (content, delegationId) => {
        // Wait messages must never be replayed after completion or reconnection.
        send({
            type: 'session.commentary.append',
            delegation_id: delegationId,
            event_id: crypto.randomUUID(),
            content: appendText(content),
        })
        lastProgressAt = Date.now()
    }
    const clearBackgroundJobs = () => {
        for (const job of backgroundJobs.values()) job.unsubscribe?.()
        backgroundJobs.clear()
    }
    const watchBackgroundJob = (id, delegationId, revision) => {
        if (ending || stopped || revision !== transcript.revision || backgroundJobs.has(id)) return
        // IDs come only from the actual VM tool result, never from model text.
        if (typeof id !== 'string' || !id || id.includes('/')) return
        const job = {
            state: null,
            progress: createLiveProgress({ publish: content => publishProgress(content, delegationId) }),
        }
        backgroundJobs.set(id, job)
        try {
            job.unsubscribe = admin
                .firestore()
                .doc(`pendingWebhooks/${id}`)
                .onSnapshot(
                    snapshot => {
                        const data = snapshot.data()
                        job.state =
                            data?.kind === 'vm_job' && data.userId === session.userId ? backgroundProgress(data) : null
                        if (job.state) job.progress.update(job.state.content)
                    },
                    () => {
                        job.state = null
                        backgroundJobs.delete(id)
                    }
                )
        } catch (_) {
            // Observation failure must not turn an already-started job into a
            // failed tool call or cause it to be started again.
            backgroundJobs.delete(id)
        }
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
        answerDelivery?.close()
        clearBackgroundJobs()
        const diagnostic = {
            trigger: why,
            at: Date.now(),
            lastUserEventAgoMs: lastUserChangeAt ? Date.now() - lastUserChangeAt : null,
            lastSpeechEventAgoMs: lastSpeechAt ? Date.now() - lastSpeechAt : null,
        }
        console.info('Live Call: Controller closing', { sessionId, ...diagnostic })
        updateCallSession(sessionId, { controllerConnected: false, serverDisconnect: diagnostic }).catch(() => {})
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
        if (event.type === 'session.commentary.appended' && event.client_event_id === 'alldone_live_greeting')
            await updateCallSession(sessionId, { greetingAcknowledgedAt: Date.now() })
        if (event.client_event_id && event.type.endsWith('.appended')) outbox.delete(event.client_event_id)
        if (event.type === 'error') {
            await updateCallSession(sessionId, {
                providerError: {
                    code: /^[a-z_]{1,80}$/.test(event.error?.code || '') ? event.error.code : 'unknown',
                    at: Date.now(),
                },
            }).catch(() => {})
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
                console.info('Live Call: Delegation received', {
                    sessionId,
                    delegationId: id,
                    revision: transcript.revision,
                })
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
                console.info('Live Call: Provider session closed', { sessionId, reason: event.reason, at: Date.now() })
                await updateCallSession(sessionId, {
                    providerClosedAt: Date.now(),
                    providerCloseReason: event.reason || 'unknown',
                }).catch(() => {})
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
            answerDelivery?.tick({ active: ready && !ending && !stopped, lastSpeechAt })
            if (answerDelivery?.pending) return
            progress?.tick({
                active:
                    ready &&
                    !ending &&
                    !stopped &&
                    !answerDelivery?.awaitingSpeech &&
                    progress.revision === transcript.revision,
                lastSpeechAt,
            })
            if (
                ready &&
                !ending &&
                !stopped &&
                !backend &&
                !answerDelivery?.awaitingSpeech &&
                Date.now() - lastProgressAt >= 20000
            ) {
                for (const [id, job] of backgroundJobs) {
                    // Dispatched jobs have their own authoritative lifecycle. A
                    // new utterance pauses updates but does not cancel that work.
                    if (job.state && job.progress.tick({ active: true, lastSpeechAt })) {
                        if (job.state.terminal) {
                            job.unsubscribe?.()
                            backgroundJobs.delete(id)
                        }
                        break
                    }
                }
            }
            // Do not rely on the voice model always delegating a short answer such
            // as “Ja, bitte”. Application-owned work uses delegation_id: null.
            if (
                ready &&
                !ending &&
                !backend &&
                !pending.size &&
                transcript.revision > handledRevision &&
                lastUserChangeAt &&
                Date.now() - lastUserChangeAt >= 3500
            ) {
                pending.set(null, { receivedAt: Date.now(), source: 'transcript_fallback' })
                console.info('Live Call: Transcript fallback queued', { sessionId, revision: transcript.revision })
            }
            if (!ready || ending || backend || !pending.size || Date.now() - lastUserChangeAt < 900) return
            const [delegationId, notice] = pending.entries().next().value
            const userGroups = transcript.messages().filter(group => group.role === 'user')
            const last = userGroups[userGroups.length - 1]
            if (!last || transcript.revision <= handledRevision) {
                if (Date.now() - notice.receivedAt > 6000) {
                    pending.delete(delegationId)
                    if (!last)
                        append(
                            'session.commentary.append',
                            'I did not receive the request clearly. Please repeat it.',
                            delegationId
                        )
                }
                return
            }
            pending.delete(delegationId)
            const revision = transcript.revision
            const runId = `${delegationId || 'transcript'}:${revision}`
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
            const runProgress = createLiveProgress({
                // Progress is ephemeral: never replay an obsolete wait after a
                // reconnect. Only actual spoken transcript fragments enter chat.
                publish: content => publishProgress(content, delegationId),
            })
            progress = { ...runProgress, revision }
            backend = runLiveAssistant({
                session,
                delegationId: runId,
                assertActive: () => assertRevision(revision),
                onProgress: runProgress.update,
                onBackgroundJob: id => watchBackgroundJob(id, delegationId, revision),
                lastUserTurn: { text: last.text, createdAt: last.receivedAt },
                requestEnd: () => {
                    requestedEnd = true
                },
            })
                .then(async result => {
                    runProgress.stop()
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
                    if (ending) {
                        await runRef.update({ deliveryStatus: 'call_ended_before_delivery' })
                        return
                    }
                    if (revision !== transcript.revision) {
                        await runRef.update({ deliveryStatus: 'superseded_before_delivery' })
                        pending.set(delegationId, { ...notice, receivedAt: Date.now() })
                        return
                    }
                    answerRevision = revision
                    answerDelivery = createLiveAnswerDelivery({
                        result,
                        delegationId,
                        append,
                        record: data => {
                            console.info('Live Call: Answer delivery', { sessionId, runId, ...data })
                            deliveryWrites = deliveryWrites
                                .then(() => runRef.update(data))
                                .catch(() =>
                                    console.warn('Live Call: Delivery diagnostics write failed', { sessionId, runId })
                                )
                        },
                        supersede: () => pending.set(delegationId, { ...notice, receivedAt: Date.now() }),
                        finish: () => requestedEnd && close('assistant_ended_call'),
                    })
                })
                .catch(async error => {
                    runProgress.stop()
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
                    else if (!ending && !superseded) {
                        const detail = voiceToolFailure(null, error)
                        console.warn('Live Call: Backend failed', { sessionId, runId, detail })
                        append(
                            'session.commentary.append',
                            `The request stopped with this error: “${detail}”. Completion has not been confirmed; check any prior tool results before retrying.`,
                            delegationId
                        )
                    }
                })
                .finally(() => {
                    progress = null
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
                            'The server tools are ready. Remain silent until the browser sends the opening greeting after audio playback is ready.',
                            null,
                            LIVE_READY_EVENT
                        )
                })
                socket.on('message', data => {
                    try {
                        const event = JSON.parse(data.toString())
                        if (
                            typeof event.client_event_id === 'string' &&
                            event.client_event_id.startsWith('alldone_live_answer_') &&
                            event.type.endsWith('.appended')
                        )
                            console.info('Live Call: Answer append acknowledged', {
                                sessionId,
                                eventId: event.client_event_id,
                                type: event.type,
                                at: Date.now(),
                            })
                        // Invalidate in-flight work at receipt, before any queued
                        // Firestore write can delay processing this correction.
                        const transcriptChanged = transcript.append(event)
                        // Delivery acknowledgments must not wait behind transcript
                        // persistence and look like a transport timeout.
                        answerDelivery?.acknowledge(event)
                        if (transcriptChanged && event.type === 'session.output_transcript.delta')
                            answerDelivery?.observeOutput()
                        if (transcriptChanged) lastSpeechAt = Date.now()
                        if (transcriptChanged && event.type === 'session.input_transcript.delta') {
                            lastUserChangeAt = Date.now()
                            if (answerDelivery && answerRevision !== transcript.revision) {
                                answerDelivery.cancel()
                                answerDelivery = null
                            }
                        }
                        if (event.type === 'session.closed') {
                            ending = true
                            answerDelivery?.close()
                            clearBackgroundJobs()
                        }
                        events = events
                            .then(() => handleEvent(event, transcriptChanged))
                            .catch(() => close('event_processing_error'))
                    } catch (_) {
                        close('event_processing_error')
                    }
                })
                socket.on('error', error => {
                    const code = [
                        'ECONNRESET',
                        'ETIMEDOUT',
                        'ECONNREFUSED',
                        'ENOTFOUND',
                        'EAI_AGAIN',
                        'EPIPE',
                    ].includes(error?.code)
                        ? error.code
                        : 'unknown'
                    console.warn('Live Call: Sideband error', { sessionId, code, attempt })
                    updateCallSession(sessionId, { sidebandError: { code, at: Date.now() } }).catch(() => {})
                    ready = false
                    close('connection_lost')
                    socket.terminate()
                    resolve()
                })
                socket.on('close', (code, closeReason) => {
                    const diagnostic = {
                        code: Number.isFinite(code) ? code : null,
                        reasonBytes: closeReason?.length || 0,
                        at: Date.now(),
                        attempt,
                        ending,
                    }
                    console.info('Live Call: Sideband closed', { sessionId, ...diagnostic })
                    updateCallSession(sessionId, { sidebandClose: diagnostic }).catch(() => {})
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
        answerDelivery?.close()
        clearBackgroundJobs()
        clearInterval(interval)
        clearTimeout(deadline)
        clearTimeout(closeTimer)
        clearTimeout(deadlineTimer)
        if (!finalized) finalized = await closeLiveSession(config, session)
        socket?.terminate()
        await events
        // Existing tool calls may complete, but assertActive prevents further actions.
        if (backend) await backend
        await deliveryWrites
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
