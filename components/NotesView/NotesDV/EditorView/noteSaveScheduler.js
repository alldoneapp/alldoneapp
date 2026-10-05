/**
 * Debounce local edits, cap continuous typing at maxWait, defer encoding to idle
 * time, and serialize snapshots. capture() is synchronous; its returned job can
 * run after the editor has closed. Changes during a job form the next snapshot.
 */
export const createNoteSaveScheduler = ({
    capture,
    debounceMs = 3000,
    maxWaitMs = 15000,
    remoteWaitMs = 60000,
    requestIdle = typeof requestIdleCallback === 'function' ? requestIdleCallback : null,
    cancelIdle = typeof cancelIdleCallback === 'function' ? cancelIdleCallback : null,
}) => {
    let local = false
    let remote = false
    let firstLocalAt = null
    let timer = null
    let idle = null
    let running = null
    let closed = false
    const clear = () => {
        clearTimeout(timer)
        timer = null
        if (idle !== null) cancelIdle?.(idle)
        idle = null
    }
    const schedule = (delay, hardDeadline = false) => {
        clear()
        timer = setTimeout(() => {
            timer = null
            const remaining = firstLocalAt === null ? 0 : Math.max(0, firstLocalAt + maxWaitMs - Date.now())
            if (!hardDeadline && requestIdle && remaining > 0) {
                idle = requestIdle(
                    () => {
                        idle = null
                        flush()
                    },
                    { timeout: remaining }
                )
                // requestIdleCallback may be throttled; the cap has its own timer.
                timer = setTimeout(flush, remaining)
            } else flush()
        }, delay)
    }
    const takeSnapshot = () => {
        if (!local && !remote) return null
        const isLocal = local
        const job = capture(isLocal)
        if (!job) return null // initial background Storage merge still pending
        local = remote = false
        firstLocalAt = null
        return job
    }
    const flush = (closing = false, snapshotWhileRunning = false) => {
        clear()
        if (closed) return running || Promise.resolve()
        // Closing must capture now, before Yjs/Quill teardown, even if an older
        // upload is in flight. The bytes, not the destroyed editor, are queued.
        if (running && !closing && !snapshotWhileRunning) return running
        const job = takeSnapshot()
        if (closing) closed = true
        if (!job) {
            if (!closed && (local || remote)) schedule(debounceMs)
            return running || Promise.resolve()
        }
        const previous = running
        const execute = () =>
            Promise.resolve()
                .then(job)
                .catch(error => {
                    console.warn('Note save failed; local persistence retains the snapshot', error)
                })
        running = previous ? previous.then(execute) : execute()
        const current = running
        current.finally(() => {
            if (running !== current) return
            running = null
            if (!closed && (local || remote)) {
                const remaining =
                    firstLocalAt === null ? remoteWaitMs : Math.max(0, firstLocalAt + maxWaitMs - Date.now())
                schedule(Math.min(local ? debounceMs : remoteWaitMs, remaining), remaining === 0)
            }
        })
        return current
    }
    return {
        markLocal() {
            if (closed) return
            local = true
            if (firstLocalAt === null) firstLocalAt = Date.now()
            const remaining = Math.max(0, firstLocalAt + maxWaitMs - Date.now())
            schedule(Math.min(debounceMs, remaining), remaining === 0)
        },
        markRemote() {
            if (closed) return
            remote = true
            if (!local && timer === null && idle === null) schedule(remoteWaitMs, true)
        },
        flush,
        close: () => flush(true),
        flushForPageHide: () => flush(false, true),
        get pending() {
            return local || remote
        },
    }
}
