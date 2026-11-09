/**
 * Which URLs the app may hand to the browser (security audit 2026-11, NV-03/NV-05/NV-36).
 *
 * Many fields that end up in `window.open`, an `<a href>` or an `<iframe src>` are written by other
 * project members or by assistants: a task's calendar link, a contact's LinkedIn URL, an attachment
 * token in a comment, a pre-configured task's link. A `javascript:` URL in any of them runs script
 * in the app's origin when a colleague clicks it: `window.open('javascript:…')` executes in the
 * opener's origin, and so does an `<a href>`. The app's CSP allows inline script, so nothing else
 * stops it.
 *
 * Only these schemes may be opened: http(s), mailto, tel, and blob (local downloads). Anything that
 * resolves against the app's own origin (a relative path) is fine. The check parses the URL the way
 * the browser does (`new URL`), so whitespace, control characters and mixed case in the scheme
 * cannot sneak `javascript:` past it.
 */

const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'blob:'])
const FRAMEABLE_PROTOCOLS = new Set(['https:'])

const getBaseOrigin = () =>
    typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : 'https://my.alldone.app'

function parseUrl(value) {
    if (value == null) return null
    const text = typeof value === 'string' ? value : String(value)
    if (!text.trim()) return null
    try {
        return new URL(text, getBaseOrigin())
    } catch (error) {
        return null
    }
}

// True for an empty value too: `window.open('')` / `about:blank` opens nothing harmful by itself.
export function isBlankUrl(value) {
    if (value == null) return true
    const text = typeof value === 'string' ? value : String(value)
    return !text.trim() || text.trim().toLowerCase() === 'about:blank'
}

export function isSafeNavigationUrl(value) {
    const url = parseUrl(value)
    return !!url && NAVIGABLE_PROTOCOLS.has(url.protocol)
}

// The URL to navigate to, or '' when it is not safe to open.
export function getSafeNavigationUrl(value) {
    return isSafeNavigationUrl(value) ? String(value).trim() : ''
}

// Frames get a stricter rule: https only (an iframe of a `data:`/`blob:`/`javascript:` URL can run
// script with the app's origin, and plain http is mixed content anyway).
export function getSafeFrameUrl(value) {
    const url = parseUrl(value)
    return url && FRAMEABLE_PROTOCOLS.has(url.protocol) ? String(value).trim() : ''
}

let installed = false

/**
 * Wraps `window.open` once so that no call site in the app (there are dozens, plus react-native-web's
 * `Linking.openURL`) can open a script URL, whatever field it reads. Explicit checks at the known
 * sinks stay; this is the backstop for the ones nobody remembered.
 */
export function installWindowOpenGuard() {
    if (installed || typeof window === 'undefined' || typeof window.open !== 'function') return
    installed = true
    const originalOpen = window.open.bind(window)
    window.open = function guardedOpen(url, ...rest) {
        if (!isBlankUrl(url) && !isSafeNavigationUrl(url)) {
            console.warn('[safeUrl] Refused to open a URL with an unsafe scheme')
            return null
        }
        return originalOpen(url, ...rest)
    }
}
