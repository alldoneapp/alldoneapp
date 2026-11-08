'use strict'

/**
 * A webhook task's URL is member-configured, and the server POSTs to it. Without a check the
 * request can reach anything the Functions network can: the metadata server, internal services,
 * localhost. This refuses non-http(s) schemes, private or internal host names, and any host whose
 * DNS answer contains a private, loopback, link-local, CGNAT or multicast address.
 *
 * Known limit: the address is checked at lookup time, and fetch resolves again (DNS rebinding).
 * Callers must also pass `redirect: 'error'` so a public URL cannot bounce the request inward.
 */

const dns = require('dns').promises
const net = require('net')
const { isPrivateHostname } = require('./browser/browserAllowlist')

function isPrivateAddress(address) {
    const value = String(address || '')
        .replace(/^\[|\]$/g, '')
        .toLowerCase()
    const family = net.isIP(value)
    if (family === 4) return isPrivateHostname(value)
    if (family !== 6) return true
    if (value === '::' || value === '::1') return true
    if (/^f[cd][0-9a-f]{0,2}:/.test(value)) return true // unique local fc00::/7
    if (/^fe[89ab][0-9a-f]?:/.test(value)) return true // link-local fe80::/10
    if (/^ff/.test(value)) return true // multicast
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value)
    if (mapped) return isPrivateHostname(mapped[1])
    if (/^64:ff9b:/.test(value)) return true // NAT64 can reach private v4 space
    return false
}

class WebhookDestinationError extends Error {
    constructor(message) {
        super(message)
        this.name = 'WebhookDestinationError'
    }
}

async function assertPublicWebhookUrl(rawUrl, { lookup = dns.lookup } = {}) {
    let parsed
    try {
        parsed = new URL(String(rawUrl || '').trim())
    } catch (error) {
        throw new WebhookDestinationError('The webhook URL could not be parsed.')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new WebhookDestinationError('Only http and https webhook URLs are allowed.')
    }
    if (parsed.username || parsed.password) {
        throw new WebhookDestinationError('Webhook URLs must not contain credentials.')
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(hostname) ? isPrivateAddress(hostname) : isPrivateHostname(hostname)) {
        throw new WebhookDestinationError('Private or internal webhook destinations are not allowed.')
    }

    let addresses
    try {
        addresses = await lookup(hostname, { all: true, verbatim: true })
    } catch (error) {
        throw new WebhookDestinationError('The webhook host could not be resolved.')
    }
    const list = Array.isArray(addresses) ? addresses : [addresses]
    if (!list.length || list.some(entry => isPrivateAddress(entry?.address || entry))) {
        throw new WebhookDestinationError('Private or internal webhook destinations are not allowed.')
    }
    return parsed.toString()
}

module.exports = {
    assertPublicWebhookUrl,
    isPrivateAddress,
    WebhookDestinationError,
}
