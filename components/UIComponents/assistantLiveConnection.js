// Keep the event receiver alive through session.closed. Closing the peer first
// loses authoritative final usage and may leave the server working on the call.
export function createLiveCallConnection(channel, { onClosed, onError, onUsage } = {}) {
    let started = false
    let controllerReady = false
    let closed = false
    let readyResolve
    let readyReject
    let closeResolve
    let readyTimer
    let closeTimer
    let closePromise
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
        if (started && controllerReady) {
            clearTimeout(readyTimer)
            readyResolve?.()
        }
        if (event.type === 'session.usage.updated') onUsage?.(event.usage)
        if (event.type === 'session.closed') {
            closed = true
            clearTimeout(readyTimer)
            clearTimeout(closeTimer)
            readyReject?.(new Error('Voice call ended before it was ready'))
            closeResolve?.(true)
            onUsage?.(event.usage)
            onClosed?.(event)
        }
        if (event.type === 'error') {
            readyReject?.(new Error('Voice connection failed'))
            onError?.()
        }
    }
    return {
        waitUntilReady() {
            if (closed) return Promise.reject(new Error('Voice call has ended'))
            if (started && controllerReady) return Promise.resolve()
            return new Promise((resolve, reject) => {
                readyResolve = resolve
                readyReject = reject
                readyTimer = setTimeout(() => reject(new Error('Voice connection timed out')), 45000)
            })
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
            clearTimeout(readyTimer)
            clearTimeout(closeTimer)
            readyReject?.(new Error('Voice connection closed'))
            closeResolve?.(false)
            channel.onmessage = null
            channel.close?.()
        },
    }
}
