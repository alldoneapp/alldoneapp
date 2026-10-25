// Keep the event receiver alive through session.closed. Closing the peer first
// loses authoritative final usage and may leave the server working on the call.
export function createLiveCallConnection(channel, { onClosed, onError, onUsage, getControllerStatus } = {}) {
    let disposed = false
    let failure = null
    let pollTimer
    let readyPromise
    let started = false
    let controllerReady = false
    let closed = false
    let readyResolve
    let readyReject
    let closeResolve
    let readyTimer
    let closeTimer
    let closePromise
    let greetingSent = false
    const resolveReady = () => {
        if (started && controllerReady && !disposed && !closed && !failure) {
            clearTimeout(readyTimer)
            clearTimeout(pollTimer)
            readyResolve?.()
        }
    }
    const fail = (error, reason = 'data_channel_error') => {
        if (disposed || closed || failure) return
        failure = error
        error.voiceReason = reason
        clearTimeout(readyTimer)
        clearTimeout(pollTimer)
        readyReject?.(error)
        onError?.(error)
    }
    const pollController = async () => {
        if (!getControllerStatus || disposed || closed || failure || (started && controllerReady)) return
        try {
            const status = await getControllerStatus()
            if (disposed || closed || failure) return
            if (status?.settled) {
                fail(new Error('Voice call ended before it was ready'), 'session_ended_before_ready')
                return
            }
            if (status?.controllerConnected) {
                controllerReady = true
                resolveReady()
            }
        } catch (_) {
            /* A transient status read must not tear down healthy WebRTC. */
        }
        if (!disposed && !closed && !failure && !(started && controllerReady))
            pollTimer = setTimeout(pollController, 1000)
    }
    channel.onmessage = message => {
        let event
        try {
            event = JSON.parse(message.data)
        } catch (_) {
            return
        }
        if (event.type === 'session.started') started = true
        if (event.type === 'session.instructions.appended' && event.client_event_id === 'alldone_live_ready')
            controllerReady = true
        resolveReady()
        if (event.type === 'session.usage.updated') onUsage?.(event.usage)
        if (event.type === 'session.closed') {
            closed = true
            clearTimeout(readyTimer)
            clearTimeout(closeTimer)
            clearTimeout(pollTimer)
            readyReject?.(new Error('Voice call ended before it was ready'))
            closeResolve?.(true)
            onUsage?.(event.usage)
            onClosed?.(event)
        }
        if (event.type === 'error') {
            fail(new Error('Voice connection failed'), 'provider_error')
        }
    }
    channel.onclose = () => fail(new Error('Voice connection closed'), 'data_channel_closed')
    channel.onerror = () => fail(new Error('Voice connection failed'))
    return {
        getChannelState: () => channel.readyState,
        isClosed: () => closed,
        greet(content) {
            if (
                !started ||
                !controllerReady ||
                disposed ||
                closed ||
                failure ||
                greetingSent ||
                channel.readyState !== 'open'
            )
                return
            try {
                channel.send(
                    JSON.stringify({
                        type: 'session.commentary.append',
                        event_id: 'alldone_live_greeting',
                        delegation_id: null,
                        content,
                    })
                )
                greetingSent = true
            } catch (_) {
                fail(new Error('Voice connection failed'))
            }
        },
        waitUntilReady() {
            if (failure) return Promise.reject(failure)
            if (closed || disposed) return Promise.reject(new Error('Voice call has ended'))
            if (started && controllerReady) return Promise.resolve()
            if (readyPromise) return readyPromise
            readyPromise = new Promise((resolve, reject) => {
                readyResolve = resolve
                readyReject = reject
                readyTimer = setTimeout(() => fail(new Error('Voice connection timed out'), 'startup_timeout'), 45000)
            })
            pollController()
            return readyPromise
        },
        close() {
            if (closed) return Promise.resolve(true)
            if (closePromise) return closePromise
            closePromise = new Promise(resolve => {
                closeResolve = resolve
                closeTimer = setTimeout(() => resolve(false), 8000)
                if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'session.close' }))
                else resolve(false)
            })
            return closePromise
        },
        dispose() {
            disposed = true
            clearTimeout(readyTimer)
            clearTimeout(closeTimer)
            clearTimeout(pollTimer)
            readyReject?.(new Error('Voice connection closed'))
            closeResolve?.(false)
            channel.onmessage = null
            channel.onclose = null
            channel.onerror = null
            channel.close?.()
        },
    }
}
