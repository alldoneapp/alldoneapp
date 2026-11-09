/**
 * What a sign-out has to take with it from this browser (security audit 2026-11, NV-41/NV-42).
 *
 * The session itself ends with `auth.signOut()`, but the account stays behind in two ways unless
 * somebody removes it: the browser's FCM token is still listed on `users/{uid}.fcmToken`, so the
 * signed-out account's pushes (project, task title, comment text) keep appearing here — and are
 * added to the NEXT account that signs in on this profile too; and the offline stores (Firestore's
 * IndexedDB cache, the y-indexeddb note bodies, the artifacts cache, the cached user document) stay
 * readable to anyone with the same browser profile.
 *
 * Every step is best effort and time-bounded: logout must work offline, with a blocked IndexedDB
 * and with another Alldone tab still open (then `clearPersistence()` fails, which is fine — that
 * tab still holds the data and is signed out by the auth state change).
 */

export const LOGOUT_STEP_TIMEOUT_MS = 3000
export const NOTE_DATABASE_PREFIX = 'alldone-note-'
export const ARTIFACTS_CACHE_DATABASE = 'alldone-artifacts-cache'

export function withTimeout(promiseOrFn, timeoutMs = LOGOUT_STEP_TIMEOUT_MS) {
    let timer
    const work = Promise.resolve()
        .then(() => (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn))
        .catch(error => {
            console.warn('[logout] cleanup step failed', error?.message || error)
        })
    const timeout = new Promise(resolve => {
        timer = setTimeout(resolve, timeoutMs)
    })
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Before sign-out (the rules need the session): drop this browser's token from the account and
 * invalidate it at FCM. Offline the document write is queued and, if the local cache is cleared
 * afterwards, lost — `deleteToken()` is then what stops delivery, and the server drops tokens
 * whose sends fail.
 */
export async function releasePushToken({ messaging, isMessagingSupported, userRef, arrayRemove, timeoutMs }) {
    if (!messaging || !isMessagingSupported || !userRef) return
    let token = null
    await withTimeout(async () => {
        // Only a browser that already granted permission has a token; never prompt during logout.
        if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return
        token = await messaging.getToken()
    }, timeoutMs)
    if (token) {
        await withTimeout(() => userRef.update({ fcmToken: arrayRemove(token) }), timeoutMs)
    }
    await withTimeout(() => messaging.deleteToken(), timeoutMs)
}

function deleteIndexedDbDatabase(indexedDB, name) {
    return new Promise(resolve => {
        try {
            const request = indexedDB.deleteDatabase(name)
            request.onsuccess = () => resolve(true)
            request.onerror = () => resolve(false)
            // Another tab still has it open: do not wait for it.
            request.onblocked = () => resolve(false)
        } catch (error) {
            resolve(false)
        }
    })
}

/** After sign-out: remove the account's offline copies from this browser profile. */
export async function clearAccountLocalData({ db, indexedDB, clearUserDataCache, timeoutMs }) {
    if (typeof clearUserDataCache === 'function') {
        await withTimeout(() => clearUserDataCache(), timeoutMs)
    }
    if (db && typeof db.terminate === 'function') {
        await withTimeout(async () => {
            await db.terminate()
            if (typeof db.clearPersistence === 'function') await db.clearPersistence()
        }, timeoutMs)
    }
    if (indexedDB) {
        await withTimeout(async () => {
            const names = new Set([ARTIFACTS_CACHE_DATABASE])
            if (typeof indexedDB.databases === 'function') {
                const databases = await indexedDB.databases()
                ;(databases || []).forEach(entry => {
                    if (entry?.name && entry.name.startsWith(NOTE_DATABASE_PREFIX)) names.add(entry.name)
                })
            }
            await Promise.all([...names].map(name => deleteIndexedDbDatabase(indexedDB, name)))
        }, timeoutMs)
    }
}
