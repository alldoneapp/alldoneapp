'use strict'

/**
 * The one gate for a server-side request to a URL that a member, a model or a fetched document
 * chose (security audit 2026-11, NV-19/21/25/29). The request runs inside the Cloud Functions
 * network with the Admin service account, so without this a URL can name the metadata server,
 * loopback, a VPC address or anything else that network reaches.
 *
 * `assertPublicUrl` refuses non-http(s) schemes, credentials in the URL, private or internal host
 * NAMES (after stripping the trailing root dot that makes `localhost.` a different string from
 * `localhost`) and any host whose DNS answer contains a private, loopback, link-local, CGNAT,
 * unique-local, multicast or IPv4-mapped-private address. `fetchPublicUrl` follows redirects
 * itself (`redirect: 'manual'`) and runs every hop through the same check, so a public URL cannot
 * bounce the request inward.
 *
 * Known limit: the address is checked at lookup time and fetch resolves the name again, so a DNS
 * answer that changes between the two (rebinding) is not caught. Closing that needs a connect-time
 * lookup hook on the HTTP agent; until then the deployed egress is the backstop.
 */

const dns = require('dns').promises
const net = require('net')
const { isPrivateHostname, isPrivateIpAddress, normalizeHostname } = require('../Assistant/browser/browserAllowlist')

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const DEFAULT_MAX_REDIRECTS = 5

class OutboundUrlError extends Error {
    constructor(message, code = 'blocked') {
        super(message)
        this.name = 'OutboundUrlError'
        this.code = code
    }
}

function isPrivateAddress(address) {
    return isPrivateIpAddress(address)
}

function parseHttpUrl(rawUrl, { httpsOnly = false } = {}) {
    let parsed
    try {
        parsed = rawUrl instanceof URL ? new URL(rawUrl.toString()) : new URL(String(rawUrl || '').trim())
    } catch (error) {
        throw new OutboundUrlError('The URL could not be parsed.', 'invalid_url')
    }
    if (httpsOnly ? parsed.protocol !== 'https:' : parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new OutboundUrlError(
            httpsOnly ? 'Only https URLs are allowed.' : 'Only http and https URLs are allowed.',
            'unsupported_scheme'
        )
    }
    if (parsed.username || parsed.password) {
        throw new OutboundUrlError('URLs must not contain credentials.', 'credentials_in_url')
    }
    return parsed
}

/**
 * Throws `OutboundUrlError` unless the URL names a public http(s) host. Returns the parsed URL.
 */
async function assertPublicUrl(rawUrl, { lookup = dns.lookup, httpsOnly = false } = {}) {
    const parsed = parseHttpUrl(rawUrl, { httpsOnly })
    const hostname = normalizeHostname(parsed.hostname)
    const literal = net.isIP(hostname) !== 0
    if (!hostname || (literal ? isPrivateAddress(hostname) : isPrivateHostname(hostname))) {
        throw new OutboundUrlError('Private or internal addresses are not allowed.', 'private_host')
    }
    if (literal) return parsed

    let addresses
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true })
    } catch (error) {
        throw new OutboundUrlError('The host could not be resolved.', 'unresolvable')
    }
    const list = Array.isArray(addresses) ? addresses : [addresses]
    if (!list.length || list.some(entry => isPrivateAddress(entry?.address || entry))) {
        throw new OutboundUrlError('Private or internal addresses are not allowed.', 'private_host')
    }
    return parsed
}

/**
 * `fetch` for a URL nobody on our side chose. Every hop, the first included, goes through
 * `assertPublicUrl`; redirects are followed by hand up to `maxRedirects`. Resolves to
 * `{ response, url }` where `url` is the URL the final response came from (a manual redirect
 * leaves `response.url` at the hop that answered, which is the same thing, but not every fetch
 * implementation sets it). Throws `OutboundUrlError` for a refused hop.
 */
async function fetchPublicUrl(rawUrl, init = {}, options = {}) {
    const {
        fetchImpl = globalThis.fetch,
        lookup = dns.lookup,
        httpsOnly = false,
        maxRedirects = DEFAULT_MAX_REDIRECTS,
        validateUrl = null,
    } = options
    let current = await assertPublicUrl(rawUrl, { lookup, httpsOnly })
    let requestInit = { ...init, redirect: 'manual' }

    for (let hop = 0; ; hop += 1) {
        if (validateUrl) validateUrl(current)
        const response = await fetchImpl(current.toString(), requestInit)
        const location = response?.headers?.get ? response.headers.get('location') : null
        if (!REDIRECT_STATUSES.has(response?.status) || !location) {
            return { response, url: current.toString() }
        }
        if (hop >= maxRedirects) {
            throw new OutboundUrlError('Too many redirects.', 'too_many_redirects')
        }
        // Drop the redirect body so the connection can be reused or closed.
        try {
            if (response.body && typeof response.body.cancel === 'function') await response.body.cancel()
        } catch (_) {}
        let next
        try {
            next = new URL(location, current)
        } catch (error) {
            throw new OutboundUrlError('The redirect location could not be parsed.', 'invalid_url')
        }
        current = await assertPublicUrl(next, { lookup, httpsOnly })
        const method = String(requestInit.method || 'GET').toUpperCase()
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
            const { body, ...rest } = requestInit
            requestInit = { ...rest, method: 'GET' }
        }
    }
}

module.exports = {
    assertPublicUrl,
    fetchPublicUrl,
    isPrivateAddress,
    OutboundUrlError,
    parseHttpUrl,
}
