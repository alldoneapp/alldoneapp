import { START_LOADING_OPERATION, FINISH_LOADING_OPERATION } from '../../redux/loadingData'
import { batchDispatch } from './dispatchBatch'

export const INITIAL_LOAD_TIMEOUT_MS = 30000
let nextOperationId = 0

// This bounds foreground feedback only. Timing out must not erase cached data,
// mark a read successful, or stop a live listener from delivering later.
export const beginLoadingOperation = (source, { deferStart = false, dispatch = batchDispatch } = {}) => {
    const id = `loading-${++nextOperationId}`
    let finished = false
    let started = false
    let startTimer
    let timeout

    const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(startTimer)
        clearTimeout(timeout)
        if (started) dispatch({ type: FINISH_LOADING_OPERATION, id })
    }

    const start = () => {
        if (finished) return
        started = true
        timeout = setTimeout(() => {
            finish()
            console.warn('[LoadingData] Initial load timed out', { source, timeoutMs: INITIAL_LOAD_TIMEOUT_MS })
        }, INITIAL_LOAD_TIMEOUT_MS)
        dispatch({ type: START_LOADING_OPERATION, id, source, startedAt: Date.now() })
    }

    if (deferStart) startTimer = setTimeout(start, 0)
    else start()
    return finish
}

// A plain listener (without a cached-snapshot gate) is ready on its first
// callback. Later snapshots and cleanup can only release this same owner.
export const subscribeWithLoading = (source, subscribe, onSnapshot, { onError, enabled = true } = {}) => {
    const finish = enabled ? beginLoadingOperation(source) : () => {}
    let disposed = false
    const fail = error => {
        disposed = true
        finish()
        console.error('[LoadingData] Snapshot listener failed', { source, code: error?.code || 'unknown' })
        onError?.(error)
    }
    let unsubscribe
    try {
        unsubscribe = subscribe((...args) => {
            if (disposed) return
            try {
                onSnapshot(...args)
            } finally {
                finish()
            }
        }, fail)
    } catch (error) {
        finish()
        throw error
    }
    let unsubscribed = false
    return () => {
        if (unsubscribed) return
        unsubscribed = true
        disposed = true
        finish()
        unsubscribe?.()
    }
}
