'use strict'

/**
 * Binds an OAuth connect flow to the browser that started it (security audit NV-23).
 *
 * The Google and MCP-client connect flows used to complete from (code, state) alone: the state was
 * only a lookup key for the initiator's request. Whoever finished the provider's consent screen
 * therefore connected THEIR account to the initiator's Alldone user. An attacker could start a Gmail
 * connect, forward the consent URL, and have a victim's mailbox tokens land in the attacker's user
 * tree (owner-readable there).
 *
 * The browser that starts a flow now creates a random nonce, keeps it in a first-party cookie on
 * the app origin and sends only its SHA-256 to the initiate callable, which stores the hash with the
 * state. The callback runs on the same origin (a hosting rewrite) and accepts the code only when the
 * request carries the cookie whose hash matches. A forwarded consent URL is completed in a browser
 * that never held the nonce, so it fails before the code is exchanged. The attacker cannot plant
 * the cookie: it lives on the Alldone origin and is never in a URL.
 *
 * The cookie is named `__session` because Firebase Hosting strips every other cookie before it
 * forwards a request to a function. It is scoped to the callback path and expires with the state.
 * The binding requires the app and the callback to share a host (my.alldone.app,
 * mystaging.alldone.app, localhost for the emulator), since a cookie is per host.
 */

const crypto = require('crypto')
const { isAllowedRedirectTarget, ALLOWED_HOSTS } = require('../WebApp/openInBrowserTab')

const OAUTH_BINDING_COOKIE = '__session'
const NONCE_HASH_PATTERN = /^[a-f0-9]{64}$/
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

function isEmulator() {
    return !!process.env.FUNCTIONS_EMULATOR
}

function normalizeBrowserNonceHash(value) {
    const hash = String(value || '')
        .trim()
        .toLowerCase()
    return NONCE_HASH_PATTERN.test(hash) ? hash : null
}

function hashBrowserNonce(nonce) {
    return crypto.createHash('sha256').update(String(nonce)).digest('hex')
}

function readCookieValues(req, name) {
    const header = req?.headers?.cookie
    if (typeof header !== 'string' || !header) return []
    return header
        .split(';')
        .map(part => part.trim())
        .filter(part => part.startsWith(`${name}=`))
        .map(part => {
            const raw = part.slice(name.length + 1)
            try {
                return decodeURIComponent(raw)
            } catch (_) {
                return raw
            }
        })
}

/** True when the request carries the nonce whose hash the flow stored at initiation. */
function requestMatchesBrowserBinding(req, expectedHash) {
    const expected = normalizeBrowserNonceHash(expectedHash)
    if (!expected) return false
    const expectedBuffer = Buffer.from(expected, 'hex')
    return readCookieValues(req, OAUTH_BINDING_COOKIE)
        .filter(value => NONCE_PATTERN.test(value))
        .some(value => crypto.timingSafeEqual(Buffer.from(hashBrowserNonce(value), 'hex'), expectedBuffer))
}

function clearBindingCookie(res, path) {
    try {
        res.append('Set-Cookie', `${OAUTH_BINDING_COOKIE}=; Path=${path}; Max-Age=0; Secure; HttpOnly; SameSite=Lax`)
    } catch (_) {}
}

/**
 * A returnUrl is where the callback sends the browser after a same-window connect. It must be an
 * Alldone origin (the openInBrowserTab allowlist); localhost only in the emulator. Returns the
 * normalized URL, or null.
 */
function normalizeOAuthReturnUrl(returnUrl) {
    if (returnUrl === undefined || returnUrl === null || returnUrl === '') return null
    const normalized = isAllowedRedirectTarget(String(returnUrl))
    if (!normalized) return null
    const { hostname } = new URL(normalized)
    if (LOCAL_HOSTNAMES.has(hostname) && !isEmulator()) return null
    return normalized
}

/** Origins the callback page may hand its result to via postMessage (never '*'). */
function getAppOrigins() {
    const origins = [...ALLOWED_HOSTS].map(host => `https://${host}`)
    if (isEmulator()) {
        origins.push('https://localhost:19006', 'http://localhost:19006', 'http://localhost:5000')
    }
    return origins
}

module.exports = {
    OAUTH_BINDING_COOKIE,
    normalizeBrowserNonceHash,
    hashBrowserNonce,
    readCookieValues,
    requestMatchesBrowserBinding,
    clearBindingCookie,
    normalizeOAuthReturnUrl,
    getAppOrigins,
}
