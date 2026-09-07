import { readDocumentDirectlyFromServer } from '../firestoreDirectRead'
import { isBrowserOffline } from '../../connectionState'
import { isManualOfflineMode } from '../../connectionHealth'

export const STATISTICS_READ_TIMEOUT_MS = 5000

const boundedRead = async (read, timeoutMs) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let timer
    try {
        return await Promise.race([
            Promise.resolve().then(() => read(controller?.signal)),
            new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    controller?.abort()
                    reject(Object.assign(new Error('Statistics read timed out'), { code: 'deadline-exceeded' }))
                }, timeoutMs)
            }),
        ])
    } finally {
        clearTimeout(timer)
    }
}

const isTransient = error =>
    ['unavailable', 'deadline-exceeded', 'internal', 'resource-exhausted'].includes(
        String(error?.code || '')
            .toLowerCase()
            .replace(/_/g, '-')
    ) ||
    error?.name === 'TypeError' ||
    error?.name === 'AbortError'

// The new-day summary must not queue behind all the task-board listeners. This
// authenticated REST read uses the same security rules and existing Auth session;
// it does not create a second Firestore client or disable the offline cache.
export const readUserStatistics = async (db, path, { preferDirect = false } = {}) => {
    if (!preferDirect) return (await db.doc(path).get()).data() || {}

    let failure
    if (!isBrowserOffline() && !isManualOfflineMode()) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const result = await boundedRead(
                    signal => readDocumentDirectlyFromServer(path, { signal }),
                    STATISTICS_READ_TIMEOUT_MS
                )
                return result.exists ? result.data : {}
            } catch (error) {
                failure = error
                // Never mask an authorization failure with stale cached data.
                if (!isTransient(error)) throw error
                if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500))
            }
        }
    }

    const cached = await boundedRead(() => db.doc(path).get({ source: 'cache' }), 1000)
    if (cached.exists) return cached.data() || {}
    throw (
        failure || Object.assign(new Error('Statistics are not available in the local cache'), { code: 'unavailable' })
    )
}
