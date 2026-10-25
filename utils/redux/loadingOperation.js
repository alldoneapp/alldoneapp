import { START_LOADING_OPERATION, FINISH_LOADING_OPERATION } from '../../redux/loadingData'
import { batchDispatch } from './dispatchBatch'

export const INITIAL_LOAD_TIMEOUT_MS = 30000
export const ACTION_LOADING_TIMEOUT_MS = 120000
let nextOperationId = 0

// This bounds foreground feedback only. Timing out must not erase cached data,
// mark a read successful, or stop a live listener from delivering later.
export const beginLoadingOperation = (
    source,
    { deferStart = false, dispatch = batchDispatch, enabled = true, timeoutMs = INITIAL_LOAD_TIMEOUT_MS } = {}
) => {
    if (!enabled) return () => {}
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
            console.warn('[LoadingData] Loading feedback timed out', { source, timeoutMs })
        }, timeoutMs)
        dispatch({ type: START_LOADING_OPERATION, id, source, startedAt: Date.now() })
    }

    if (deferStart) startTimer = setTimeout(start, 0)
    else start()
    return finish
}

// The deadline only retires foreground feedback. It never cancels a write,
// resolves its promise early, or reports success before the work completes.
export const runWithLoading = async (source, work, options = {}) => {
    const finish = beginLoadingOperation(source, { timeoutMs: ACTION_LOADING_TIMEOUT_MS, ...options })
    try {
        return await work()
    } finally {
        finish()
    }
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
