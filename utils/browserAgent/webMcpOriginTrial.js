/**
 * WebMCP origin-trial tokens (AT-2871).
 *
 * Chrome 149–156 ship WebMCP (`document.modelContext`) as an origin trial: without a valid token for
 * the page's origin the API does not exist in a stock browser, and `window.alldone` is all a browser
 * agent gets. Tokens are bound to one origin and are public by design (they are sent in every page),
 * so they live here rather than in CI secrets.
 *
 * Status (AT-2890): no token is registered yet, so production has NO native WebMCP. Until one is,
 * `window.alldone` is the only browser surface.
 *
 * To enable it:
 *   1. Open https://developer.chrome.com/origintrials, pick the "WebMCP" trial and click "Register".
 *   2. Web origin: https://my.alldone.app (repeat for https://mystaging.alldone.app and the
 *      alldonestaging.web.app origin used for staging QA). Leave "third-party matching" off.
 *   3. Paste each token under its host below (hostname only, no scheme) and deploy the web app.
 *   4. Verify in Chrome 149+: `!!document.modelContext` is true after sign-in, and the
 *      `#alldone-agent-api` manifest reports `webMcp.available: true` with a tool count.
 *   Tokens expire with the trial (or per renewal); an expired token simply makes the API disappear.
 * Tokens are bound to one origin. Chrome accepts a token injected from script into a
 * `<meta http-equiv="origin-trial">` tag; it then exposes the API from that moment on, which is why
 * this runs before the bridge looks for `document.modelContext`.
 */

export const WEBMCP_ORIGIN_TRIAL_TOKENS = {
    // 'my.alldone.app': '<token>',
    // 'mystaging.alldone.app': '<token>',
}

export const ensureWebMcpOriginTrialToken = (
    doc = typeof document === 'undefined' ? null : document,
    hostname = typeof window === 'undefined' ? '' : window.location?.hostname || '',
    tokens = WEBMCP_ORIGIN_TRIAL_TOKENS
) => {
    const token = tokens[hostname]
    if (!doc || !doc.head || !token) return false
    const existing = Array.from(doc.head.querySelectorAll('meta[http-equiv="origin-trial"]')).some(
        meta => meta.getAttribute('content') === token
    )
    if (existing) return true
    const meta = doc.createElement('meta')
    meta.setAttribute('http-equiv', 'origin-trial')
    meta.setAttribute('content', token)
    doc.head.appendChild(meta)
    return true
}
