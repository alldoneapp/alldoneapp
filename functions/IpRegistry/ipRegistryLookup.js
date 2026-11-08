'use strict'

const net = require('net')
const { getEnvFunctions } = require('../envFunctionsHelper')

// security audit 2026-11 (NV-24): this callable used to interpolate a caller-supplied `data.ip`
// into the ipregistry URL path, so any signed-in session could geolocate any address, or 1024 of
// them in one comma-separated call, on Alldone's paid key. And the app's own call (no `ip`) looked
// up the address that reached ipregistry — the Functions egress IP, not the user. The callable now
// ignores `data` and looks up exactly one address: the caller's, as Google's front end saw it.

const FALLBACK = { country: { name: 'United States' } }
const LOOKUP_RATE_LIMIT = { name: 'ipRegistryLookup', limit: 10, windowMs: 24 * 60 * 60 * 1000 }

function isPublicIp(value) {
    if (net.isIP(value) === 0) return false
    const { isPrivateIpAddress } = require('../Assistant/browser/browserAllowlist')
    return !isPrivateIpAddress(value)
}

/**
 * The caller's public IP. Google's front end APPENDS the address it saw to `X-Forwarded-For`, so
 * the entries a client sends itself come first; the rightmost public entry is the one we can trust.
 * (`req.ip` is the leftmost entry under the framework's `trust proxy`, which the client controls.)
 */
function getCallerIp(rawRequest) {
    const header = rawRequest?.headers?.['x-forwarded-for']
    const entries = (Array.isArray(header) ? header.join(',') : String(header || ''))
        .split(',')
        .map(entry => entry.trim().replace(/^\[|\]$/g, ''))
        .filter(Boolean)
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (isPublicIp(entries[index])) return entries[index]
    }
    const direct = String(rawRequest?.socket?.remoteAddress || rawRequest?.ip || '').replace(/^::ffff:/, '')
    return isPublicIp(direct) ? direct : null
}

/**
 * @param {{ userId: string, rawRequest: object }} context
 * @returns {Promise<Object>} Location information
 */
const ipRegistryLookup = async ({ userId, rawRequest } = {}, deps = {}) => {
    const { IP_REGISTRY_API_KEY } = (deps.getEnv || getEnvFunctions)()

    if (!IP_REGISTRY_API_KEY) {
        console.warn('IP_REGISTRY_API_KEY is not configured, using default fallback location')
        return { success: false, error: 'IP_REGISTRY_API_KEY is not configured', location: FALLBACK }
    }

    const callerIp = getCallerIp(rawRequest)
    if (!callerIp) {
        return { success: false, error: 'The caller address is unknown', location: FALLBACK }
    }

    const { consumeCallableQuota } = require('../shared/callableRateLimit')
    const db = deps.db || require('firebase-admin').firestore()
    await consumeCallableQuota(db, { ...LOOKUP_RATE_LIMIT, userId })

    try {
        const url = `https://api.ipregistry.co/${encodeURIComponent(callerIp)}?key=${encodeURIComponent(
            IP_REGISTRY_API_KEY
        )}`
        const response = await (deps.fetchImpl || fetch)(url, { method: 'GET' })

        if (!response.ok) {
            console.error('IP Registry API error:', { status: response.status })
            throw new Error(`IP Registry API error: ${response.status}`)
        }

        const result = await response.json()
        return {
            success: true,
            location: result.location,
            timeZone: result.time_zone,
            currency: result.currency,
        }
    } catch (error) {
        console.error('Failed to perform IP registry lookup:', { error: error.message })
        return { success: false, error: 'The location lookup failed', location: FALLBACK }
    }
}

module.exports = { getCallerIp, ipRegistryLookup }
