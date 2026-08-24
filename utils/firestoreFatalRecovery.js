/**
 * Recovers the page from an unrecoverable Firestore client assertion.
 *
 * Firestore's AsyncQueue permanently rejects every later operation after an
 * internal assertion. In that state another probe or disableNetwork/enableNetwork
 * cycle cannot repair the client; only a fresh page can create a new queue.
 *
 * The ca9 pending-response assertion is normally raised from an ignored async
 * queue promise, so listen for `unhandledrejection`. Later calls surface the
 * stored failure as b815 and can instead reach the window error listener or the
 * React error boundary; `reportFatalFirestoreError` covers that last path.
 */

export const FIRESTORE_FATAL_RECOVERY_STORAGE_KEY = 'alldone.firestoreFatalRecoveryAt'
export const FIRESTORE_FATAL_RECOVERY_COOLDOWN_MS = 60 * 1000
export const FIRESTORE_FATAL_RECOVERY_DELAY_MS = 250

const FIRESTORE_INTERNAL_ASSERTION_PATTERN = /FIRESTORE[\s\S]*INTERNAL ASSERTION FAILED[\s\S]*ID:\s*(?:ca9|b815)\b/i

const errorText = (value, seen = new Set()) => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if ((typeof value === 'object' || typeof value === 'function') && seen.has(value)) return ''
    if (typeof value === 'object' || typeof value === 'function') seen.add(value)

    const parts = []
    if (value.message) parts.push(value.message)
    if (value.stack) parts.push(value.stack)
    if (value.reason) parts.push(errorText(value.reason, seen))
    if (value.error) parts.push(errorText(value.error, seen))
    if (value.cause) parts.push(errorText(value.cause, seen))

    if (parts.length === 0) {
        try {
            parts.push(String(value))
        } catch (error) {
            return ''
        }
    }
    return parts.join('\n')
}

export const isFatalFirestoreInternalError = value => FIRESTORE_INTERNAL_ASSERTION_PATTERN.test(errorText(value))

let activeRecoveryReporter = null
let globalRecoveryStop = null

/**
 * Gives React's error boundary the same recovery path as the global browser
 * listeners. Returns true only for the fatal Firestore assertion family.
 */
export const reportFatalFirestoreError = error => {
    if (!isFatalFirestoreInternalError(error)) return false
    if (activeRecoveryReporter) activeRecoveryReporter(error)
    return true
}

const getSessionStorage = windowObject => {
    try {
        return windowObject && windowObject.sessionStorage
    } catch (error) {
        return null
    }
}

const readRecoveryTime = storage => {
    if (!storage) return null
    try {
        const stored = Number(storage.getItem(FIRESTORE_FATAL_RECOVERY_STORAGE_KEY))
        return Number.isFinite(stored) && stored > 0 ? stored : null
    } catch (error) {
        return null
    }
}

const writeRecoveryTime = (storage, timestamp) => {
    if (!storage) return
    try {
        storage.setItem(FIRESTORE_FATAL_RECOVERY_STORAGE_KEY, String(timestamp))
    } catch (error) {
        // The in-memory latch still prevents duplicate reloads in this document.
    }
}

export const installFirestoreFatalRecovery = ({
    windowObject = typeof window === 'undefined' ? undefined : window,
    storage,
    now = Date.now,
    reload,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    cooldownMs = FIRESTORE_FATAL_RECOVERY_COOLDOWN_MS,
    reloadDelayMs = FIRESTORE_FATAL_RECOVERY_DELAY_MS,
} = {}) => {
    if (!windowObject || !windowObject.addEventListener) return () => {}

    const sessionStorage = storage === undefined ? getSessionStorage(windowObject) : storage
    const reloadPage = reload || (() => windowObject.location.reload())
    const isOffline = () => !!windowObject.navigator && windowObject.navigator.onLine === false
    let fatalPending = false
    let reloadStarted = false
    let reloadTimer

    const attemptRecovery = () => {
        if (!fatalPending || reloadStarted || reloadTimer !== undefined || isOffline()) return

        const currentTime = now()
        const previousRecoveryTime = readRecoveryTime(sessionStorage)
        const elapsed = previousRecoveryTime === null ? null : currentTime - previousRecoveryTime
        if (elapsed !== null && elapsed >= 0 && elapsed < cooldownMs) {
            // A second assertion immediately after the replacement page loaded
            // must not create a reload loop. Leave the error visible for diagnosis.
            fatalPending = false
            console.error('[FirestoreRecovery] Fatal assertion repeated during reload cooldown; reload suppressed.')
            return
        }

        reloadTimer = setTimer(() => {
            reloadTimer = undefined
            // Connectivity can disappear during the short reporting delay. Keep
            // the request pending and let the next online event try again.
            if (isOffline()) return

            fatalPending = false
            reloadStarted = true
            writeRecoveryTime(sessionStorage, now())
            console.warn('[FirestoreRecovery] Reloading after an unrecoverable Firestore client assertion.')
            reloadPage()
        }, reloadDelayMs)
    }

    const requestRecovery = error => {
        if (!isFatalFirestoreInternalError(error)) return false
        fatalPending = true
        attemptRecovery()
        return true
    }

    const onError = event => requestRecovery(event && (event.error || event.message || event))
    const onUnhandledRejection = event => requestRecovery(event && (event.reason || event))
    const onOnline = () => attemptRecovery()

    windowObject.addEventListener('error', onError)
    windowObject.addEventListener('unhandledrejection', onUnhandledRejection)
    windowObject.addEventListener('online', onOnline)
    activeRecoveryReporter = requestRecovery

    return () => {
        if (reloadTimer !== undefined) clearTimer(reloadTimer)
        windowObject.removeEventListener('error', onError)
        windowObject.removeEventListener('unhandledrejection', onUnhandledRejection)
        windowObject.removeEventListener('online', onOnline)
        if (activeRecoveryReporter === requestRecovery) activeRecoveryReporter = null
    }
}

/** Install exactly once for the lifetime of the root browser document. */
export const installGlobalFirestoreFatalRecovery = () => {
    if (globalRecoveryStop) return globalRecoveryStop

    const stop = installFirestoreFatalRecovery()
    globalRecoveryStop = () => {
        stop()
        globalRecoveryStop = null
    }
    return globalRecoveryStop
}

export const resetFirestoreFatalRecoveryForTests = () => {
    if (globalRecoveryStop) globalRecoveryStop()
    activeRecoveryReporter = null
}
