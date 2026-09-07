'use strict'

// Which hosts the browser worker may ever open.
//
// Two access modes, and the difference between them is ONLY the last question this file asks:
//
//   `selected`    (default) the host must match a configured allowlist entry
//   `all_public`  (opt-in)  any host that survives the safety checks below is allowed
//
// Everything before that last question is identical in both modes and is not configurable:
// http(s) only, no credentials in the URL, no IP literals, no loopback / private / link-local /
// CGNAT / IPv6-ULA ranges, no cloud metadata endpoints, no single-label or `.internal` / `.local`
// names, and an explicit denylist that wins over both modes. "All public websites" therefore means
// exactly that — the public web — and can never be talked into reaching infrastructure.
//
// `selected` stays the default because a browser is not a reader: it holds a live session, follows
// redirects, runs the page's scripts and can be asked to click, so the ordinary posture is a set of
// hosts somebody chose. `all_public` exists because the ordinary posture cannot answer "look this up
// for me" about a site nobody listed in advance.
//
// Entry syntax (all normalized through `normalizeAllowlistEntry`):
//
//   example.com            apex and every subdomain
//   *.example.com          subdomains only, not the apex
//   example.com/events     as above, but the path must start with /events
//   https://example.com    a pasted URL is accepted; scheme and the rest are discarded
//
// Deliberately unsupported: bare `*`, a single-label host, an IP literal, anything with credentials
// or a port. Each of those is either a way to accidentally allow the whole internet or a way to
// point the worker at infrastructure.

const { DENY_REASONS } = require('./browserToolContract')

const BLOCKED_HOST_PATTERNS = [
    // Kept in step with webPageFetcher: a login wall answers a datacenter IP with a redirect or a
    // 999, and a browser that lands there is one prompt away from being asked to log in.
    /(^|\.)linkedin\.com$/i,
    /(^|\.)licdn\.com$/i,
]

const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /\.localhost$/i,
    /\.local$/i,
    /\.internal$/i,
    /\.home\.arpa$/i,
    /^metadata\.google\.internal$/i,
    /^metadata$/i,
]

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function parseIPv4(hostname) {
    const match = IPV4_PATTERN.exec(String(hostname || ''))
    if (!match) return null
    const octets = match.slice(1).map(part => Number(part))
    if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
    return octets
}

function isPrivateIPv4(octets) {
    const [a, b] = octets
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local, and the cloud metadata address
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    if (a >= 224) return true // multicast and reserved
    return false
}

function isPrivateIPv6(hostname) {
    const value = String(hostname || '')
        .replace(/^\[|\]$/g, '')
        .toLowerCase()
    if (!value.includes(':')) return false
    if (value === '::1' || value === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true // unique local fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true // link-local fe80::/10
    // An IPv4-mapped address hides a v4 literal inside a v6 one.
    const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value)
    if (mapped) {
        const octets = parseIPv4(mapped[1])
        return octets ? isPrivateIPv4(octets) : true
    }
    return false
}

/**
 * A host that is an address rather than a name. Allowlisting by IP is refused outright: it is the
 * shortest path to pointing the worker at something inside the network it runs in, and there is no
 * legitimate "visit this public page" use for it.
 */
function isIpLiteralHostname(hostname) {
    const value = String(hostname || '')
    return !!parseIPv4(value) || value.includes(':') || /^\[/.test(value)
}

function isPrivateHostname(hostname) {
    const value = String(hostname || '').toLowerCase()
    if (!value) return true
    if (PRIVATE_HOST_PATTERNS.some(pattern => pattern.test(value))) return true
    const octets = parseIPv4(value)
    if (octets) return isPrivateIPv4(octets)
    if (isPrivateIPv6(value)) return true
    // A single-label host ("intranet", "wiki") only resolves inside a private network.
    return !value.includes('.')
}

function isBlockedHostname(hostname) {
    return BLOCKED_HOST_PATTERNS.some(pattern => pattern.test(String(hostname || '')))
}

const ACCESS_MODE_SELECTED = 'selected'
const ACCESS_MODE_ALL_PUBLIC = 'all_public'
const ACCESS_MODES = [ACCESS_MODE_SELECTED, ACCESS_MODE_ALL_PUBLIC]

/**
 * Anything that is not exactly `all_public` is `selected`.
 *
 * The default is not a preference, it is the fail-closed direction: a corrupt document, a typo, an
 * older client writing a field it does not know about, or a future mode name all have to land on
 * "only the hosts somebody listed" rather than on "the whole internet".
 */
function normalizeAccessMode(value) {
    return String(value || '') === ACCESS_MODE_ALL_PUBLIC ? ACCESS_MODE_ALL_PUBLIC : ACCESS_MODE_SELECTED
}

/**
 * The one shape every layer passes around: the mode, the allowlist and the denylist, already
 * normalized. `browserConfig` builds it, the worker token carries it, and the policy and the
 * worker's network guard both decide from it — so there is no second place where "which hosts" is
 * answered and no way for a client to answer it differently.
 */
function buildBrowsingPolicy({ mode, allowlist = [], denylist = [] } = {}) {
    const allowed = Array.isArray(allowlist) ? allowlist : normalizeAllowlist(allowlist).entries
    const denied = Array.isArray(denylist) ? denylist : normalizeAllowlist(denylist).entries
    return { mode: normalizeAccessMode(mode), entries: allowed, denyEntries: denied }
}

/** Accepts the policy object or a bare entry array (the pre-modes shape) and answers as `selected`. */
function toBrowsingPolicy(policyOrEntries) {
    if (Array.isArray(policyOrEntries))
        return buildBrowsingPolicy({ mode: ACCESS_MODE_SELECTED, allowlist: policyOrEntries })
    if (policyOrEntries && typeof policyOrEntries === 'object') {
        return buildBrowsingPolicy({
            mode: policyOrEntries.mode,
            allowlist: policyOrEntries.entries || policyOrEntries.allowlist || [],
            denylist: policyOrEntries.denyEntries || policyOrEntries.denylist || [],
        })
    }
    return buildBrowsingPolicy({})
}

function findMatchingEntry(hostname, pathname, entries) {
    return (Array.isArray(entries) ? entries : []).find(
        entry => hostMatchesEntry(hostname, entry) && pathMatchesEntry(pathname, entry)
    )
}

/**
 * Parse one configured allowlist entry. Returns null for anything unusable — a bad entry is dropped
 * rather than widened into something permissive, and `normalizeAllowlist` reports what it rejected
 * so a misconfiguration is visible in the audit record instead of silently allowing nothing.
 */
function normalizeAllowlistEntry(rawEntry) {
    const raw = typeof rawEntry === 'string' ? rawEntry.trim() : ''
    if (!raw || raw === '*') return null

    let value = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    value = value.replace(/^\/+/, '')
    if (!value) return null

    let subdomainsOnly = false
    if (value.startsWith('*.')) {
        subdomainsOnly = true
        value = value.slice(2)
    }

    const slashIndex = value.indexOf('/')
    let host = slashIndex === -1 ? value : value.slice(0, slashIndex)
    const pathPrefixRaw = slashIndex === -1 ? '' : value.slice(slashIndex)

    host = host.trim().toLowerCase().replace(/\.$/, '')
    if (!host || host.includes('*') || host.includes('@') || host.includes(':')) return null
    if (isIpLiteralHostname(host)) return null
    if (isPrivateHostname(host)) return null
    // Refuse a bare public suffix ("com", "co.uk" is not detectable without a PSL, but a single
    // label is, and it is the entry that would allow every host under a TLD).
    if (!host.includes('.')) return null
    if (!/^[a-z0-9.-]+$/.test(host)) return null

    // A bare `/` is not a path constraint, it is the root — `example.com/` (a pasted URL) must
    // normalize to the same entry as `example.com`, or the two look like different rules and the
    // editor's duplicate check cannot see them as one.
    const pathPrefix = pathPrefixRaw ? pathPrefixRaw.replace(/\/+$/, '') : ''

    return { host, subdomainsOnly, pathPrefix }
}

function normalizeAllowlist(entries) {
    const list = Array.isArray(entries) ? entries : typeof entries === 'string' ? entries.split(/[\s,;]+/) : []

    const normalized = []
    const rejected = []
    const seen = new Set()
    for (const entry of list) {
        const raw = typeof entry === 'string' ? entry.trim() : ''
        if (!raw) continue
        const parsed = normalizeAllowlistEntry(raw)
        if (!parsed) {
            rejected.push(raw)
            continue
        }
        const key = `${parsed.subdomainsOnly ? '*.' : ''}${parsed.host}${parsed.pathPrefix}`
        if (seen.has(key)) continue
        seen.add(key)
        normalized.push(parsed)
    }
    return { entries: normalized, rejected }
}

function hostMatchesEntry(hostname, entry) {
    const host = String(hostname || '')
        .toLowerCase()
        .replace(/\.$/, '')
    if (!host) return false
    if (host === entry.host) return !entry.subdomainsOnly
    return host.endsWith(`.${entry.host}`)
}

function pathMatchesEntry(pathname, entry) {
    if (!entry.pathPrefix) return true
    const path = String(pathname || '/')
    if (path === entry.pathPrefix) return true
    return path.startsWith(entry.pathPrefix.endsWith('/') ? entry.pathPrefix : `${entry.pathPrefix}/`)
}

/**
 * The single URL gate. Every navigation, every redirect hop and every worker-reported final URL is
 * run through this — a redirect that leaves what is permitted has to fail exactly like a navigation
 * to the same host would, or the policy is decorative.
 *
 * The second argument is a browsing policy (`buildBrowsingPolicy`) or, for the pre-modes call sites
 * and their tests, a bare entry array, which is read as `selected`.
 */
function checkUrlAgainstAllowlist(rawUrl, policyOrEntries) {
    const value = typeof rawUrl === 'string' ? rawUrl.trim() : ''
    if (!value) return { allowed: false, reason: DENY_REASONS.UNSUPPORTED_SCHEME, message: 'A URL is required.' }

    let parsed
    try {
        parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`)
    } catch (error) {
        return { allowed: false, reason: DENY_REASONS.UNSUPPORTED_SCHEME, message: 'The URL could not be parsed.' }
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
            allowed: false,
            reason: DENY_REASONS.UNSUPPORTED_SCHEME,
            message: 'Only http and https URLs can be opened.',
        }
    }
    if (parsed.username || parsed.password) {
        return {
            allowed: false,
            reason: DENY_REASONS.CREDENTIALS_IN_URL,
            message: 'URLs carrying credentials are refused.',
        }
    }
    if (isBlockedHostname(parsed.hostname)) {
        return {
            allowed: false,
            reason: DENY_REASONS.BLOCKED_HOST,
            message: `${parsed.hostname} is blocked for automated browsing (it requires a login).`,
        }
    }
    if (isPrivateHostname(parsed.hostname) || isIpLiteralHostname(parsed.hostname)) {
        return {
            allowed: false,
            reason: DENY_REASONS.PRIVATE_HOST,
            message: 'Private, internal and literal-IP addresses cannot be opened.',
        }
    }

    const policy = toBrowsingPolicy(policyOrEntries)

    // The denylist is checked BEFORE the mode, so it means the same thing in both: "not this host,
    // whatever else is configured". Checking it after the mode would make it dead weight in
    // `selected` (where it can only remove something the allowlist already excluded) and, worse,
    // would invite the reading that it is an `all_public`-only feature.
    const denied = findMatchingEntry(parsed.hostname, parsed.pathname, policy.denyEntries)
    if (denied) {
        return {
            allowed: false,
            reason: DENY_REASONS.NOT_ALLOWLISTED,
            message: `${parsed.hostname} is on this project's blocked list for automated browsing.`,
            hostname: parsed.hostname,
            deniedByEntry: denied,
        }
    }

    if (policy.mode === ACCESS_MODE_ALL_PUBLIC) {
        // Every safety check above has already run. What is left is, by construction, a public
        // http(s) host that nobody blocked.
        return { allowed: true, url: parsed.toString(), hostname: parsed.hostname, matchedEntry: null, allPublic: true }
    }

    const matched = findMatchingEntry(parsed.hostname, parsed.pathname, policy.entries)
    if (!matched) {
        return {
            allowed: false,
            reason: DENY_REASONS.NOT_ALLOWLISTED,
            message: policy.entries.length
                ? `${parsed.hostname} is not on the browsing allowlist for this project.`
                : 'Browsing is not configured for this project: the allowlist is empty, so every host is denied.',
            hostname: parsed.hostname,
        }
    }

    return { allowed: true, url: parsed.toString(), hostname: parsed.hostname, matchedEntry: matched }
}

module.exports = {
    ACCESS_MODES,
    ACCESS_MODE_ALL_PUBLIC,
    ACCESS_MODE_SELECTED,
    BLOCKED_HOST_PATTERNS,
    buildBrowsingPolicy,
    checkUrlAgainstAllowlist,
    findMatchingEntry,
    normalizeAccessMode,
    toBrowsingPolicy,
    hostMatchesEntry,
    isBlockedHostname,
    isIpLiteralHostname,
    isPrivateHostname,
    normalizeAllowlist,
    normalizeAllowlistEntry,
    pathMatchesEntry,
}
