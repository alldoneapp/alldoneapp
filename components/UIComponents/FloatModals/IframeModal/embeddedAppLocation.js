/**
 * "Open the embedded app's current page in a new tab" (AT-2954).
 *
 * An embedded app runs in a cross-origin iframe (alldone.team), so Alldone CANNOT read where the
 * user has navigated inside it: `iframe.contentWindow.location` throws for a cross-origin frame,
 * the iframe's `src` attribute never changes when the page navigates itself, and the `load` event
 * says that something loaded, not what. The only honest source of "the current page" is the app
 * itself. An app may therefore report its address with
 *
 *     window.parent.postMessage({ type: 'EMBED_LOCATION', url: location.href }, '*')
 *
 * whenever it navigates (EmbeddedAppFrame accepts it under the same checks as every other message
 * of the protocol: the exact iframe window and the iframe's own origin). Until an app reports
 * anything, the start URL is all Alldone knows, and that is what opens.
 */

export const EMBED_LOCATION_MESSAGE_TYPE = 'EMBED_LOCATION'

// Generous for a real address, but bounded: the value comes from third-party code.
const MAX_REPORTED_URL_LENGTH = 4096

/**
 * The address an app reported, if Alldone may open it: an absolute http(s) URL on the same origin
 * as the URL the frame was opened with. Anything else (another origin, `javascript:`, garbage) is
 * null, so a compromised or confused page can never make the button open an arbitrary site.
 */
export const resolveReportedLocation = (reportedUrl, startUrl) => {
    if (typeof reportedUrl !== 'string' || !reportedUrl || reportedUrl.length > MAX_REPORTED_URL_LENGTH) return null
    try {
        const reported = new URL(reportedUrl)
        const start = new URL(startUrl)
        if (reported.protocol !== 'https:' && reported.protocol !== 'http:') return null
        if (reported.origin !== start.origin) return null
        return reported.toString()
    } catch (error) {
        return null
    }
}

const isAlldoneAppUrl = url => {
    try {
        return typeof window !== 'undefined' && new URL(url).origin === window.location.origin
    } catch (error) {
        return false
    }
}

/**
 * Opens `url` in a new browser tab/window. Returns true when the browser opened one, false when it
 * refused (pop-up blocker, no `window.open`), so the caller keeps the app on screen instead of
 * closing it with nothing to show for it.
 *
 * Must run synchronously inside the click handler, or desktop pop-up blockers refuse it.
 */
export const openEmbeddedAppInNewTab = url => {
    if (!url || typeof window === 'undefined' || typeof window.open !== 'function') return false

    // An app served from Alldone's own origin is inside the installed PWA's scope, and a plain
    // window.open would open a second app window; reuse the escape hatch for that (AT-2345).
    // A third-party origin is out of the PWA's scope, so it opens in the browser directly.
    // Not `noopener` in the features: with it window.open always returns null, and a blocked pop-up
    // could no longer be told apart from an opened one. The opener is cut by hand instead, so the
    // app's page cannot navigate Alldone's tab (reverse tabnabbing).
    const opened = isAlldoneAppUrl(url)
        ? require('../../../../utils/openInNewWindow').openViewInNewWindow(url)
        : window.open(url, '_blank')
    if (!opened) return false
    try {
        opened.opener = null
    } catch (error) {
        // The new tab already left about:blank; nothing more to do.
    }
    return true
}
