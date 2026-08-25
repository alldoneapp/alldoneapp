const WEB_SHARE_TARGET_STORAGE_KEY = 'alldone.webShareTarget.v1'

export const WEB_SHARE_TARGET_PARAMS = {
    title: 'share_title',
    text: 'share_text',
    url: 'share_url',
}

const normaliseSharedText = value =>
    String(value || '')
        .trim()
        .replace(/\s+/g, ' ')

const findFirstWebUrl = value => {
    const match = String(value || '').match(/https?:\/\/[^\s<>"']+/i)
    return match ? match[0] : ''
}

const createPayload = taskName => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    taskName,
})

const getSessionStorage = () => {
    try {
        return typeof window !== 'undefined' ? window.sessionStorage : null
    } catch (error) {
        return null
    }
}

/**
 * Turns a Web Share Target GET request into the text for the existing add-task
 * popup. Android commonly puts a shared URL in `text` rather than `url`, so URL
 * extraction deliberately checks all three fields before falling back to plain
 * shared text.
 */
export const parseWebShareTarget = search => {
    const params = new URLSearchParams(search || '')
    const hasShareData = Object.values(WEB_SHARE_TARGET_PARAMS).some(name => params.has(name))
    if (!hasShareData) return null

    const title = params.get(WEB_SHARE_TARGET_PARAMS.title) || ''
    const text = params.get(WEB_SHARE_TARGET_PARAMS.text) || ''
    const url = params.get(WEB_SHARE_TARGET_PARAMS.url) || ''
    const taskName =
        findFirstWebUrl(url) ||
        findFirstWebUrl(text) ||
        findFirstWebUrl(title) ||
        normaliseSharedText(text) ||
        normaliseSharedText(title) ||
        normaliseSharedText(url)

    return taskName ? createPayload(taskName) : null
}

const readStoredWebShareTarget = storage => {
    if (!storage) return null
    try {
        const payload = JSON.parse(storage.getItem(WEB_SHARE_TARGET_STORAGE_KEY))
        return payload && payload.id && payload.taskName ? payload : null
    } catch (error) {
        return null
    }
}

/**
 * Captures the launch payload before login or URL routing can rewrite the
 * address bar. sessionStorage lets a mobile OAuth redirect finish without
 * losing the link; it is cleared as soon as the popup opens.
 */
export const loadPendingWebShareTarget = (
    search = typeof window !== 'undefined' && window.location ? window.location.search : '',
    storage = getSessionStorage()
) => {
    const incomingPayload = parseWebShareTarget(search)
    if (!incomingPayload) return readStoredWebShareTarget(storage)

    try {
        storage?.setItem(WEB_SHARE_TARGET_STORAGE_KEY, JSON.stringify(incomingPayload))
    } catch (error) {
        // Storage can be unavailable in private browsing; the in-memory
        // payload still lets an already authenticated session continue.
    }
    return incomingPayload
}

export const clearStoredWebShareTarget = (storage = getSessionStorage()) => {
    try {
        storage?.removeItem(WEB_SHARE_TARGET_STORAGE_KEY)
    } catch (error) {
        // A failed cleanup is harmless; URL cleanup still prevents a replay in
        // the current tab and a new incoming share replaces this value.
    }
}

/**
 * The payload now lives in memory/sessionStorage, so remove it from browser
 * history. This also prevents a refresh from reopening a task draft that was
 * already consumed.
 */
export const cleanWebShareTargetParamsFromCurrentUrl = () => {
    if (typeof window === 'undefined' || !window.location || !window.history) return

    const url = new URL(window.location.href)
    const hadShareParams = Object.values(WEB_SHARE_TARGET_PARAMS).some(name => url.searchParams.has(name))
    if (!hadShareParams) return

    Object.values(WEB_SHARE_TARGET_PARAMS).forEach(name => url.searchParams.delete(name))
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
