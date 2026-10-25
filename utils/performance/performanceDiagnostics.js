const DEBUG_QUERY_PARAM = 'perfDebug'
const DISABLE_PERSISTENCE_QUERY_PARAM = 'perfDisablePersistence'
const DISABLE_NOTES_PREFETCH_QUERY_PARAM = 'perfDisableNotesPrefetch'

export const PERFORMANCE_DEBUG_STORAGE_KEY = 'alldone.performance.debug'
export const PERFORMANCE_DISABLE_PERSISTENCE_STORAGE_KEY = 'alldone.performance.disablePersistence'
export const PERFORMANCE_DISABLE_NOTES_PREFETCH_STORAGE_KEY = 'alldone.performance.disableNotesPrefetch'

const isEnabledValue = value => value === '1' || value === 'true'

const readQueryFlag = key => {
    try {
        if (typeof window === 'undefined' || !window.location) return null
        const params = new URLSearchParams(window.location.search || '')
        if (!params.has(key)) return null
        return isEnabledValue(params.get(key))
    } catch (error) {
        return null
    }
}

const readStorageFlag = key => {
    try {
        if (typeof localStorage === 'undefined') return false
        return isEnabledValue(localStorage.getItem(key))
    } catch (error) {
        return false
    }
}

const readFlag = (queryKey, storageKey) => {
    const queryValue = readQueryFlag(queryKey)
    return queryValue === null ? readStorageFlag(storageKey) : queryValue
}

/**
 * Explicit diagnostic switches for controlled performance comparisons.
 *
 * Query parameters win over localStorage, so `?perfDisablePersistence=0` can
 * temporarily override a stored experiment without deleting it. None of the
 * switches is enabled by default and none is tied to user or project identity.
 */
export const getPerformanceDiagnostics = () => {
    const disableFirestorePersistence = readFlag(
        DISABLE_PERSISTENCE_QUERY_PARAM,
        PERFORMANCE_DISABLE_PERSISTENCE_STORAGE_KEY
    )
    const disableNotesPrefetch = readFlag(
        DISABLE_NOTES_PREFETCH_QUERY_PARAM,
        PERFORMANCE_DISABLE_NOTES_PREFETCH_STORAGE_KEY
    )

    return {
        debug:
            readFlag(DEBUG_QUERY_PARAM, PERFORMANCE_DEBUG_STORAGE_KEY) ||
            disableFirestorePersistence ||
            disableNotesPrefetch,
        disableFirestorePersistence,
        disableNotesPrefetch,
    }
}

export const isPerformanceDebugEnabled = () => getPerformanceDiagnostics().debug
