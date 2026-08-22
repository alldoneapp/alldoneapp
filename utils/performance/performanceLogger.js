import { trackEvent } from '../analytics/analytics'
import { isPerformanceDebugEnabled } from './performanceDiagnostics'

export const PERFORMANCE_EVENT_NAME = 'performance_trace'
export const DEFAULT_PERFORMANCE_SAMPLE_RATE = 0.1
const MAX_DEBUG_RECORDS = 1000
const MAX_STRING_LENGTH = 100

const SAFE_METADATA_KEYS = new Set([
    'trace_name',
    'trace_id',
    'phase',
    'source',
    'scope',
    'object_type',
    'outcome',
    'page_path',
    'duration_ms',
    'step_duration_ms',
    'project_count',
    'watcher_count',
    'document_count',
    'task_count',
    'subtask_count',
    'write_count',
    'batch_count',
    'candidate_count',
    'note_count',
    'byte_count',
    'error_count',
    'network_duration_ms',
    'indexeddb_duration_ms',
    'max_duration_ms',
    'from_cache',
    'diagnostic_mode',
    'dom_interactive_ms',
    'dom_content_loaded_ms',
    'load_event_ms',
    'count',
])

let debugRecords = []
const namedTraces = new Map()
let browserObserversInstalled = false
const NOOP_TRACE = Object.freeze({
    mark: () => false,
    end: () => false,
    fail: () => false,
    isEnded: () => true,
    isSampled: () => false,
})

export const performanceNow = () => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
    return Date.now()
}

const roundDuration = value => Math.max(0, Math.round(Number(value) || 0))

const sanitizeValue = value => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH)
    return undefined
}

export const sanitizePerformanceMetadata = metadata => {
    const sanitized = {}
    Object.entries(metadata || {}).forEach(([key, value]) => {
        if (!SAFE_METADATA_KEYS.has(key)) return
        const safeValue = sanitizeValue(value)
        if (safeValue !== undefined) sanitized[key] = safeValue
    })
    return sanitized
}

const createTraceId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

const appendDebugRecord = record => {
    debugRecords.push(record)
    if (debugRecords.length > MAX_DEBUG_RECORDS) debugRecords = debugRecords.slice(-MAX_DEBUG_RECORDS)

    if (typeof window !== 'undefined') {
        window.__alldonePerformance = {
            getRecords: () => [...debugRecords],
            clear: () => {
                debugRecords = []
            },
        }
    }
}

const emitRecord = (record, { sampled, debug }) => {
    if (!sampled && !debug) return false
    const safeRecord = sanitizePerformanceMetadata(record)
    appendDebugRecord(safeRecord)
    if (debug && typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info('[Performance]', safeRecord)
    }
    if (sampled) trackEvent(PERFORMANCE_EVENT_NAME, safeRecord)
    return true
}

const shouldSample = sampleRate => Math.random() < Math.min(1, Math.max(0, sampleRate))

export const startPerformanceTrace = (
    traceName,
    metadata = {},
    { sampleRate = DEFAULT_PERFORMANCE_SAMPLE_RATE } = {}
) => {
    const debug = isPerformanceDebugEnabled()
    const sampled = debug || shouldSample(sampleRate)
    if (!sampled && !debug) return NOOP_TRACE
    const traceId = createTraceId()
    const startedAt = performanceNow()
    let lastMarkAt = startedAt
    let ended = false
    const baseMetadata = sanitizePerformanceMetadata(metadata)

    const emit = (phase, extraMetadata, finish) => {
        if (ended) return false
        const markedAt = performanceNow()
        const record = {
            ...baseMetadata,
            ...sanitizePerformanceMetadata(extraMetadata),
            trace_name: traceName,
            trace_id: traceId,
            phase,
            duration_ms: roundDuration(markedAt - startedAt),
            step_duration_ms: roundDuration(markedAt - lastMarkAt),
        }
        lastMarkAt = markedAt
        if (finish) ended = true
        return emitRecord(record, { sampled, debug })
    }

    return {
        mark: (phase, extraMetadata = {}) => emit(phase, extraMetadata, false),
        end: (phase = 'complete', extraMetadata = {}) => emit(phase, extraMetadata, true),
        fail: (phase = 'failed', extraMetadata = {}) => emit(phase, { ...extraMetadata, outcome: 'failed' }, true),
        isEnded: () => ended,
        isSampled: () => sampled,
    }
}

export const startNamedPerformanceTrace = (key, traceName, metadata = {}, options = {}) => {
    const existing = namedTraces.get(key)
    if (existing && !existing.isEnded()) existing.end('superseded', { outcome: 'cancelled' })
    const trace = startPerformanceTrace(traceName, metadata, options)
    namedTraces.set(key, trace)
    return trace
}

export const markNamedPerformanceTrace = (key, phase, metadata = {}) => {
    const trace = namedTraces.get(key)
    return trace ? trace.mark(phase, metadata) : false
}

export const endNamedPerformanceTrace = (key, phase = 'complete', metadata = {}) => {
    const trace = namedTraces.get(key)
    if (!trace) return false
    const emitted = trace.end(phase, metadata)
    namedTraces.delete(key)
    return emitted
}

export const logPerformanceMeasurement = (traceName, phase, durationMs, metadata = {}, options = {}) => {
    const debug = isPerformanceDebugEnabled()
    const sampled = debug || shouldSample(options.sampleRate ?? DEFAULT_PERFORMANCE_SAMPLE_RATE)
    if (!sampled && !debug) return false
    return emitRecord(
        {
            ...metadata,
            trace_name: traceName,
            trace_id: createTraceId(),
            phase,
            duration_ms: roundDuration(durationMs),
            step_duration_ms: roundDuration(durationMs),
        },
        { sampled, debug }
    )
}

export const schedulePerformanceAfterPaint = callback => {
    if (typeof requestAnimationFrame !== 'function') {
        const timer = setTimeout(callback, 0)
        return () => clearTimeout(timer)
    }
    let secondFrame = null
    const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(callback)
    })
    return () => {
        cancelAnimationFrame(firstFrame)
        if (secondFrame !== null) cancelAnimationFrame(secondFrame)
    }
}

/** Native browser timing plus aggregated main-thread long-task windows. */
export const installBrowserPerformanceObservers = () => {
    if (browserObserversInstalled || typeof window === 'undefined' || typeof document === 'undefined') return () => {}
    browserObserversInstalled = true

    const debug = isPerformanceDebugEnabled()
    const sampled = debug || shouldSample(DEFAULT_PERFORMANCE_SAMPLE_RATE)
    if (!sampled && !debug) return () => {}

    const cleanups = []
    const emitNavigationTiming = () => {
        if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return
        const navigation = performance.getEntriesByType('navigation')[0]
        if (!navigation) return
        logPerformanceMeasurement(
            'browser_navigation',
            'loaded',
            navigation.loadEventEnd || navigation.duration,
            {
                dom_interactive_ms: roundDuration(navigation.domInteractive),
                dom_content_loaded_ms: roundDuration(navigation.domContentLoadedEventEnd),
                load_event_ms: roundDuration(navigation.loadEventEnd || navigation.duration),
            },
            { sampleRate: 1 }
        )
    }

    if (document.readyState === 'complete') {
        setTimeout(emitNavigationTiming, 0)
    } else {
        window.addEventListener('load', emitNavigationTiming, { once: true })
        cleanups.push(() => window.removeEventListener('load', emitNavigationTiming))
    }

    if (typeof PerformanceObserver === 'function') {
        try {
            let count = 0
            let totalDurationMs = 0
            let maxDurationMs = 0
            const observer = new PerformanceObserver(list => {
                list.getEntries().forEach(entry => {
                    count++
                    totalDurationMs += entry.duration
                    maxDurationMs = Math.max(maxDurationMs, entry.duration)
                })
            })
            observer.observe({ entryTypes: ['longtask'] })
            const interval = setInterval(() => {
                if (count === 0) return
                logPerformanceMeasurement(
                    'main_thread_long_tasks',
                    'window',
                    totalDurationMs,
                    { count, max_duration_ms: roundDuration(maxDurationMs) },
                    { sampleRate: 1 }
                )
                count = 0
                totalDurationMs = 0
                maxDurationMs = 0
            }, 10000)
            cleanups.push(() => {
                clearInterval(interval)
                observer.disconnect()
            })
        } catch (error) {
            // Safari and older embedded browsers do not support the longtask entry type.
        }
    }

    return () => cleanups.forEach(cleanup => cleanup())
}

export const __resetPerformanceLoggerForTests = () => {
    debugRecords = []
    namedTraces.clear()
    browserObserversInstalled = false
}
