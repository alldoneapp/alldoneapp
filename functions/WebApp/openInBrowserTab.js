/**
 * "Open view in new window" from an installed desktop PWA (AT-2345).
 *
 * A Chromium (or WebKit) installed web app keeps every navigation that falls INSIDE its
 * manifest scope inside the app window. Alldone's manifests declare no explicit `scope`,
 * so the scope defaults to the `start_url` directory (`/`) — i.e. the whole origin — and
 * `window.open(window.location, '_blank')` therefore spawns a second PWA window instead of
 * the browser tab users expect. There is no web API that overrides that; the ONLY lever a
 * web app has is making the *destination* fall outside the scope.
 *
 * This endpoint is that lever. It lives on `*.cloudfunctions.net`, a different origin from
 * the app's hosting domain and therefore unambiguously out of scope, and does nothing but
 * 302 to the requested Alldone URL. The browser opens the out-of-scope target in a normal
 * tab, follows the redirect there, and the user lands on the requested view in the browser.
 * A server redirect followed inside a browser tab is not re-captured into the app window.
 *
 * Because it is a redirector, it is an open-redirect risk by construction. `u` is therefore
 * validated against an explicit host allowlist (`isAllowedRedirectTarget`) and anything else
 * is rejected with 400 — never redirected to.
 */

// Hosts the app is actually served from. Everything else is refused.
//   - my./mystaging. alldone.app          production + staging hosting domains
//   - <site>.web.app / .firebaseapp.com   default Firebase Hosting domains
//   - <site>--<channel>-<hash>.web.app    Firebase Hosting preview channels (deploy:web-webpack-preview)
const ALLOWED_HOSTS = new Set([
    'my.alldone.app',
    'mystaging.alldone.app',
    'alldone.app',
    'www.alldone.app',
    'alldonealeph.web.app',
    'alldonealeph.firebaseapp.com',
    'alldonestaging.web.app',
    'alldonestaging.firebaseapp.com',
])

const ALLOWED_HOST_PATTERNS = [
    // Firebase Hosting preview channels, e.g. alldonestaging--webpack-my-branch-a1b2c3d4.web.app
    /^alldone(aleph|staging)--[a-z0-9-]+\.web\.app$/,
]

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * @param {string} rawUrl candidate absolute URL taken from the `u` query parameter
 * @returns {string|null} the normalized URL when it points at an Alldone origin, else null
 */
const isAllowedRedirectTarget = rawUrl => {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2048) return null

    let parsed
    try {
        parsed = new URL(rawUrl)
    } catch (e) {
        return null
    }

    const host = parsed.hostname
    const isLocal = LOCAL_HOSTS.has(host)

    // http is tolerated only for local development; every real origin must be https.
    if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) return null

    if (isLocal) return parsed.toString()
    if (ALLOWED_HOSTS.has(host)) return parsed.toString()
    if (ALLOWED_HOST_PATTERNS.some(pattern => pattern.test(host))) return parsed.toString()

    return null
}

const handleOpenInBrowserTab = (req, res) => {
    const raw = req && req.query ? req.query.u : undefined
    const target = isAllowedRedirectTarget(Array.isArray(raw) ? raw[0] : raw)

    // Never cache the redirect itself; the target changes with every click.
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')

    if (!target) {
        res.status(400).send('Invalid or missing redirect target.')
        return
    }

    res.redirect(302, target)
}

module.exports = { handleOpenInBrowserTab, isAllowedRedirectTarget, ALLOWED_HOSTS, ALLOWED_HOST_PATTERNS }
