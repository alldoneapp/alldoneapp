'use strict'

/**
 * Which redirect URIs an MCP OAuth client may use (security audit 2026-11, NV-34).
 *
 * Dynamic client registration stored any `redirect_uris` it was sent, and the login page on
 * my.alldone.app finally does `window.location.href = redirect_to`. A client registered with
 * `javascript://localhost/%0a…` therefore ran script on the app's own origin, next to the session
 * the victim had just signed in with, and the consent screen even showed it as host "localhost".
 *
 * Allowed: https to any host; http only to the loopback interface (RFC 8252 §7.3, local MCP
 * clients); a private-use app scheme such as `cursor://` or `vscode://` (RFC 8252 §7.1), which the
 * browser hands to the installed app. Never a scheme the browser itself evaluates: javascript,
 * data, vbscript, file, blob, about, filesystem, view-source.
 */

const BROWSER_EVALUATED_SCHEMES = new Set([
    'javascript:',
    'data:',
    'vbscript:',
    'file:',
    'blob:',
    'about:',
    'filesystem:',
    'view-source:',
])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:$/

function isAllowedOAuthRedirectUri(value) {
    if (typeof value !== 'string' || !value || value.length > 2048) return false
    // Raw control characters and whitespace are never part of a legitimate redirect URI, and the
    // URL parser strips some of them, so check the raw string first.
    if (/[\u0000- \u007f]/.test(value)) return false
    let url
    try {
        url = new URL(value)
    } catch (error) {
        return false
    }
    const protocol = url.protocol.toLowerCase()
    if (!SCHEME_PATTERN.test(protocol) || BROWSER_EVALUATED_SCHEMES.has(protocol)) return false
    if (protocol === 'https:') return !!url.hostname
    if (protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
    // A private-use scheme must at least look like one (reverse-DNS or a known app name with //).
    return value.slice(protocol.length).startsWith('/')
}

module.exports = { isAllowedOAuthRedirectUri }
