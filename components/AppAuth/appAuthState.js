/**
 * Anna's one-time sign-in state for the /app-auth page.
 *
 * Anna (the macOS menubar app, alldone.team) opens `https://my.alldone.app/app-auth?state=<value>`
 * with a random one-time value and only accepts a `hybridmeetingguard://auth` callback that returns
 * that same value. Without it any page or link could hand Anna an attacker's account.
 *
 * The state has to survive the login detour: the login screen rewrites the address bar to /login,
 * and on mobile a Google sign-in is a full-page redirect that wipes redux. It is therefore captured
 * once at boot (before anything rewrites the URL), kept in sessionStorage for this tab only, removed
 * from the address bar at once, and handed back only inside the callback URL. Nothing else may see it:
 * not the address bar, not `initialUrl` (which reaches the marketing list and the user document for
 * new accounts), not analytics.
 *
 * Backward compatible: Anna builds before 0.8.49 send no state, and then the callback carries none.
 */

export const APP_AUTH_PATH = '/app-auth'
export const APP_AUTH_STATE_PARAM = 'state'
export const APP_AUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
export const APP_AUTH_STATE_STORAGE_KEY = 'alldone.appAuth.annaState.v1'
// Anna lets the state expire after 10 minutes; keeping it longer could only produce a callback
// Anna rejects anyway.
export const APP_AUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000

const APP_SCHEME = 'hybridmeetingguard'

// Fallback when sessionStorage refuses writes (some private-browsing modes): a signed-in tab still
// reaches the page without a reload, so the captured value can be read from memory.
let memoryRecord = null

const getSessionStorage = () => {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : null
    } catch (error) {
        return null
    }
}

export const sanitizeAppAuthState = value =>
    typeof value === 'string' && APP_AUTH_STATE_PATTERN.test(value) ? value : null

const isAppAuthPath = pathname => (pathname || '').replace(/\/+$/, '') === APP_AUTH_PATH

/** A query carrying more than one `state` is ambiguous, so it counts as invalid. */
const readStateFromSearch = search => {
    const values = new URLSearchParams(search || '').getAll(APP_AUTH_STATE_PARAM)
    return values.length === 1 ? sanitizeAppAuthState(values[0]) : null
}

export const clearPendingAppAuthState = (storage = getSessionStorage()) => {
    memoryRecord = null
    try {
        storage?.removeItem(APP_AUTH_STATE_STORAGE_KEY)
    } catch (error) {
        // Nothing to clean up when storage is unavailable.
    }
}

/**
 * The state of the sign-in this tab started, or null when there is none, it is malformed or it has
 * expired. A stored value that is unusable is removed.
 */
export const readPendingAppAuthState = (storage = getSessionStorage(), now = Date.now()) => {
    let record = null
    try {
        record = storage ? JSON.parse(storage.getItem(APP_AUTH_STATE_STORAGE_KEY)) : null
    } catch (error) {
        record = null
    }
    if (!record) record = memoryRecord
    if (!record) return null

    const state = sanitizeAppAuthState(record.state)
    const savedAt = Number(record.savedAt)
    const fresh = Number.isFinite(savedAt) && savedAt <= now && now - savedAt <= APP_AUTH_STATE_MAX_AGE_MS
    if (!state || !fresh) {
        clearPendingAppAuthState(storage)
        return null
    }
    return state
}

export const hasPendingAppAuthState = (storage, now) => readPendingAppAuthState(storage, now) !== null

/**
 * Runs once at boot. On /app-auth it records the incoming state (or forgets an earlier one when this
 * visit carries none or an invalid one, so an older Anna never receives a stale value) and strips the
 * `state` parameter from the address bar. Anywhere else it does nothing.
 */
export const captureAppAuthStateFromLocation = ({
    location = typeof window !== 'undefined' ? window.location : null,
    history = typeof window !== 'undefined' ? window.history : null,
    storage = getSessionStorage(),
    now = Date.now(),
} = {}) => {
    if (!location || !isAppAuthPath(location.pathname)) return null

    const state = readStateFromSearch(location.search)
    memoryRecord = state ? { state, savedAt: now } : null
    try {
        if (state) {
            storage?.setItem(APP_AUTH_STATE_STORAGE_KEY, JSON.stringify(memoryRecord))
        } else {
            storage?.removeItem(APP_AUTH_STATE_STORAGE_KEY)
        }
    } catch (error) {
        // Private browsing can refuse storage. An already signed-in tab still gets the state from
        // memory; only a redirect login would lose it.
    }

    const params = new URLSearchParams(location.search || '')
    if (params.has(APP_AUTH_STATE_PARAM) && history && typeof history.replaceState === 'function') {
        params.delete(APP_AUTH_STATE_PARAM)
        const query = params.toString()
        history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash || ''}`)
    }
    return state
}

/**
 * Where a login that started on /login (or /) should land: back on /app-auth while this tab still
 * has a pending Anna sign-in. That is the Google redirect case, which returns to /login with an empty
 * redux store; a popup login already keeps `/app-auth` as its initial URL.
 */
export const resolveAppAuthReturnUrl = (pathname, storage, now) => {
    const isLoginEntry = pathname === '/' || (pathname || '').startsWith('/login')
    return isLoginEntry && hasPendingAppAuthState(storage, now) ? APP_AUTH_PATH : null
}

export const buildAppAuthCallbackUrl = ({ token, email, name, gold, state }) => {
    const params = [
        `provider=${encodeURIComponent('alldone-app')}`,
        `token=${encodeURIComponent(token || '')}`,
        `email=${encodeURIComponent(email || '')}`,
        `name=${encodeURIComponent(name || '')}`,
        `gold=${encodeURIComponent(gold != null ? gold : 0)}`,
    ]
    const validState = sanitizeAppAuthState(state)
    if (validState) params.push(`${APP_AUTH_STATE_PARAM}=${encodeURIComponent(validState)}`)
    return `${APP_SCHEME}://auth?${params.join('&')}`
}
