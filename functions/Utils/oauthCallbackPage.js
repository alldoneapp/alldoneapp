'use strict'

/**
 * Pages returned by the OAuth callbacks (Google, Microsoft, MCP client). They are served on the
 * app origin through hosting rewrites, so any request data reflected into them runs with the
 * user's Alldone session. They used to interpolate `error`, `state` and `err.message` straight
 * into HTML and into a `<script>` element; a value containing `</script><script>…` ended the
 * script element regardless of JS string quoting (security audit 2026-11, reflected XSS).
 *
 * Rules: every value placed in a script goes through `scriptJson`, every value placed in HTML
 * through `escapeHtml`, and the page carries a nonce CSP so an injected inline script would not
 * run even if one of those were missed.
 */

const crypto = require('crypto')

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch])
}

/** JSON that is safe inside an HTML <script> element. */
function scriptJson(value) {
    return JSON.stringify(value === undefined ? null : value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
}

const MAX_MESSAGE_LENGTH = 300

/** Keeps provider error codes readable and drops anything that is not a plain code. */
function normalizeOAuthErrorCode(value) {
    const text = String(Array.isArray(value) ? value[0] : value || '')
    return /^[a-z0-9_.-]{1,64}$/i.test(text) ? text : 'oauth_failed'
}

function boundedMessage(value) {
    return String(value == null ? '' : value).slice(0, MAX_MESSAGE_LENGTH)
}

function setPageHeaders(res, nonce) {
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    res.set(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`
    )
}

/**
 * Sends a page that posts `message` to the opener and closes itself.
 * `bodyHtml` must already be escaped by the caller.
 */
function sendOpenerMessagePage(res, message, { bodyHtml = '', closeDelayMs = 0, status = 200 } = {}) {
    const nonce = crypto.randomBytes(16).toString('base64')
    setPageHeaders(res, nonce)
    const close = closeDelayMs > 0 ? `setTimeout(function(){window.close()},${Number(closeDelayMs)})` : 'window.close()'
    res.status(status).send(
        `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:24px">` +
            bodyHtml +
            `<script nonce="${nonce}">try{window.opener&&window.opener.postMessage(${scriptJson(message)},'*')}catch(e){}` +
            `${close}</script></body></html>`
    )
}

module.exports = {
    escapeHtml,
    scriptJson,
    normalizeOAuthErrorCode,
    boundedMessage,
    sendOpenerMessagePage,
}
