/**
 * "Open view in new window" — escaping an installed desktop PWA (AT-2345).
 *
 * `window.open(window.location, '_blank')` is the whole implementation of the top-right
 * new-window button in every detailed view, and it does the right thing in an ordinary
 * browser tab. Inside an INSTALLED app window it does not: Chromium (and WebKit's macOS
 * "Add to Dock" apps) keep any navigation whose target falls inside the app's manifest
 * scope inside the app, so the click spawns a second PWA window. Alldone's manifests
 * declare no explicit `scope`, so scope defaults to the `start_url` directory — the entire
 * origin — and every Alldone URL is in scope.
 *
 * No web API overrides that decision. The only lever available to the page is the scope
 * itself: an out-of-scope target IS handed to the default browser. So when (and only when)
 * we are running inside an installed app window, we open a redirector that lives on the
 * Cloud Functions origin — a different origin, therefore out of scope — which immediately
 * 302s to the URL we actually wanted (`functions/WebApp/openInBrowserTab.js`). The browser
 * opens the out-of-scope URL in a normal tab and follows the redirect there.
 *
 * Deliberate carve-outs:
 *   - An ordinary browser tab keeps the plain, direct `window.open`. No extra hop, no
 *     dependency on the redirector being reachable; behaviour is byte-for-byte unchanged.
 *   - iOS/iPadOS home-screen apps (`navigator.standalone === true`) also keep the direct
 *     call. There `_blank` already leaves the web app and hands the URL to the browser, so
 *     the bounce would buy nothing and only add a hop that can fail.
 *   - Every failure to build the bounce URL falls back to the direct call, so the button
 *     can never become a no-op.
 *
 * `window.open` stays synchronous inside the click handler in all paths — deferring it
 * behind an await is what trips desktop popup blockers.
 */

export const BROWSER_TAB_REDIRECT_FUNCTION = 'openInBrowserTab'

// Display modes a browser reports for an installed app window. `standalone` covers Chrome's
// installed apps and Safari's macOS "Add to Dock" apps; the others are listed because a
// manifest change (or `display_override`) must not silently reintroduce the bug.
const INSTALLED_APP_DISPLAY_MODES = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay']

/**
 * iOS/iPadOS home-screen web apps. Legacy WebKit flag, still the only reliable signal there.
 */
export const isIosHomeScreenApp = () => {
    if (typeof window === 'undefined' || !window.navigator) return false
    return window.navigator.standalone === true
}

/**
 * True inside an installed app window (Chrome "Install app", Safari "Add to Dock", Edge…).
 */
export const isInstalledAppWindow = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return INSTALLED_APP_DISPLAY_MODES.some(mode => {
        try {
            const result = window.matchMedia(`(display-mode: ${mode})`)
            return !!(result && result.matches)
        } catch (e) {
            return false
        }
    })
}

/**
 * Only desktop installed apps need the bounce — see the carve-outs in the module header.
 */
export const shouldRouteThroughBrowserBounce = () => isInstalledAppWindow() && !isIosHomeScreenApp()

const resolveFunctionsTarget = () => {
    // Required lazily: this module is imported by leaf UI controls, and pulling the Firebase
    // bridge into their module graph at import time would drag Firebase into unrelated tests.
    try {
        const Backend = require('./BackendBridge').default
        return { projectId: Backend.getFirebaseProjectId(), region: Backend.getFunctionsRegion() }
    } catch (e) {
        return { projectId: null, region: null }
    }
}

/**
 * @param {string} targetUrl absolute Alldone URL to land on
 * @returns {string|null} out-of-scope redirector URL, or null when it cannot be built
 */
export const buildBrowserBounceUrl = targetUrl => {
    if (typeof targetUrl !== 'string' || targetUrl.length === 0) return null

    const { projectId, region } = resolveFunctionsTarget()
    if (!projectId || !region) return null

    const origin = `https://${region}-${projectId}.cloudfunctions.net`
    return `${origin}/${BROWSER_TAB_REDIRECT_FUNCTION}?u=${encodeURIComponent(targetUrl)}`
}

const currentHref = () => {
    if (typeof window === 'undefined' || !window.location) return ''
    return String(window.location.href || window.location)
}

/**
 * Open a view in a new browser tab/window, escaping the installed app window when needed.
 *
 * @param {string} [targetUrl] defaults to the current location
 * @returns {Window|null} whatever `window.open` returned, mirroring the previous behaviour
 */
export const openViewInNewWindow = targetUrl => {
    if (typeof window === 'undefined' || typeof window.open !== 'function') return null

    const url = typeof targetUrl === 'string' && targetUrl.length > 0 ? targetUrl : currentHref()

    if (shouldRouteThroughBrowserBounce()) {
        const bounceUrl = buildBrowserBounceUrl(url)
        if (bounceUrl) {
            const opened = window.open(bounceUrl, '_blank')
            // A blocked or refused popup returns null; fall through to the direct call rather
            // than leaving the button looking broken.
            if (opened) return opened
        }
    }

    return window.open(url, '_blank')
}

export default openViewInNewWindow
