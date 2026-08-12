// Which engine serves search READS (TYPESENSE_MIGRATION.md Phase 3). Writes dual-write to
// both stores regardless, so flipping this back to 'algolia' is a complete, instant
// rollback — both indexes are current at all times until Phase 5 decommissions Algolia.
import Backend from './BackendBridge'

export const SEARCH_ENGINE = 'typesense' // 'typesense' | 'algolia'

// Key-aware on purpose: a build whose env lacks the Typesense keys (CI variables not set,
// stale .env) silently falls back to Algolia reads instead of shipping a broken search.
export const useTypesenseSearch = () => {
    if (SEARCH_ENGINE !== 'typesense') return false
    try {
        const { TYPESENSE_HOST, TYPESENSE_SEARCH_ONLY_API_KEY } = Backend.getTypesenseSearchKeys()
        return !!(TYPESENSE_HOST && TYPESENSE_SEARCH_ONLY_API_KEY)
    } catch (error) {
        return false
    }
}
