/**
 * Client-side validation for the browsing allowlist the user edits in Tools Access.
 *
 * This is the second implementation of a rule that already exists on the server
 * (`functions/Assistant/browser/browserAllowlist.js`), and that duplication is deliberate rather
 * than accidental: Cloud Functions code cannot be imported into the web bundle, and an allowlist
 * editor that cannot tell the user *why* an entry is wrong until after it silently disappeared is
 * not an editor. The same split already exists for `isEmailHandledInMailbox` (AT-2376).
 *
 * The contract between the two, pinned by `functions/Assistant/browser/browserAllowlistParity.test.js`:
 *
 *   1. Anything this module ACCEPTS, the server accepts, and normalizes to the same entry. Without
 *      that, an entry saves, reads back as allowed in the UI, and is dropped at browse time — the
 *      worst failure available here, because it looks like the allowlist is being ignored.
 *   2. Anything the server REJECTS, this module rejects. It may additionally reject things the
 *      server would merely tolerate (a non-http scheme, say) in order to give a better message.
 *
 * Entry syntax: `example.com` (apex + subdomains), `*.example.com` (subdomains only),
 * `example.com/events` (path prefix), or a pasted URL whose scheme is discarded.
 */

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /\.localhost$/i,
    /\.local$/i,
    /\.internal$/i,
    /\.home\.arpa$/i,
    /^metadata\.google\.internal$/i,
    /^metadata$/i,
]

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
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
}

function isPrivateIPv6(hostname) {
    const value = String(hostname || '')
        .replace(/^\[|\]$/g, '')
        .toLowerCase()
    if (!value.includes(':')) return false
    if (value === '::1' || value === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true
    const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value)
    if (mapped) {
        const octets = parseIPv4(mapped[1])
        return octets ? isPrivateIPv4(octets) : true
    }
    return false
}

export function isIpLiteralHostname(hostname) {
    const value = String(hostname || '')
    return !!parseIPv4(value) || value.includes(':') || /^\[/.test(value)
}

export function isPrivateHostname(hostname) {
    const value = String(hostname || '').toLowerCase()
    if (!value) return true
    if (PRIVATE_HOST_PATTERNS.some(pattern => pattern.test(value))) return true
    const octets = parseIPv4(value)
    if (octets) return isPrivateIPv4(octets)
    if (isPrivateIPv6(value)) return true
    return !value.includes('.')
}

/**
 * Validate one entry as typed.
 *
 * @returns {{ ok: true, value: string, host: string }} or `{ ok: false, errorKey: string }`,
 * where `errorKey` is an i18n key so the field can explain the specific problem.
 */
export function validateAllowlistEntry(rawEntry, existingEntries = []) {
    const raw = typeof rawEntry === 'string' ? rawEntry.trim() : ''
    if (!raw) return { ok: false, errorKey: 'browser_allowlist_error_empty' }
    if (raw === '*' || raw === '*.' || raw === '*.*') {
        return { ok: false, errorKey: 'browser_allowlist_error_wildcard' }
    }

    const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw)
    if (schemeMatch && !['http', 'https'].includes(schemeMatch[1].toLowerCase())) {
        // Stricter than the server, which simply discards the scheme. Saying so is more useful than
        // silently turning `ftp://example.com` into `example.com`.
        return { ok: false, errorKey: 'browser_allowlist_error_scheme' }
    }

    let value = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '')
    if (!value) return { ok: false, errorKey: 'browser_allowlist_error_invalid' }

    let subdomainsOnly = false
    if (value.startsWith('*.')) {
        subdomainsOnly = true
        value = value.slice(2)
    }

    const slashIndex = value.indexOf('/')
    let host = slashIndex === -1 ? value : value.slice(0, slashIndex)
    const pathPrefixRaw = slashIndex === -1 ? '' : value.slice(slashIndex)

    host = host.trim().toLowerCase().replace(/\.$/, '')
    if (!host) return { ok: false, errorKey: 'browser_allowlist_error_invalid' }
    if (host.includes('*')) return { ok: false, errorKey: 'browser_allowlist_error_wildcard' }
    // A port or credentials in the host: the server drops the entry entirely, so refusing it here
    // with a readable reason is the same verdict, said earlier.
    if (host.includes('@') || host.includes(':')) return { ok: false, errorKey: 'browser_allowlist_error_invalid' }
    if (isIpLiteralHostname(host) || isPrivateHostname(host)) {
        // A single-label host ("intranet") lands here too; it only resolves inside a private
        // network, so "private address" is the honest message.
        return {
            ok: false,
            errorKey: host.includes('.') ? 'browser_allowlist_error_private' : 'browser_allowlist_error_tld',
        }
    }
    if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, errorKey: 'browser_allowlist_error_invalid' }

    // A bare `/` is the root, not a path constraint: `example.com/` and `example.com` are one
    // entry. Kept identical to the server rule.
    const pathPrefix = pathPrefixRaw ? pathPrefixRaw.replace(/\/+$/, '') : ''
    const normalized = `${subdomainsOnly ? '*.' : ''}${host}${pathPrefix}`

    if ((existingEntries || []).some(entry => normalizeAllowlistEntryText(entry) === normalized)) {
        return { ok: false, errorKey: 'browser_allowlist_error_duplicate' }
    }

    return { ok: true, value: normalized, host }
}

/** The stored form of an entry, for comparing what is already on the list. */
export function normalizeAllowlistEntryText(entry) {
    const result = validateAllowlistEntry(entry, [])
    return result.ok
        ? result.value
        : String(entry || '')
              .trim()
              .toLowerCase()
}

/** Split a pasted block (commas, spaces, newlines) into individual entries. */
export function splitAllowlistInput(text) {
    return String(text || '')
        .split(/[\s,;]+/)
        .map(entry => entry.trim())
        .filter(Boolean)
}

export function sanitizeStoredAllowlist(entries) {
    if (!Array.isArray(entries)) return []
    const seen = new Set()
    const output = []
    for (const entry of entries) {
        const result = validateAllowlistEntry(entry, [])
        if (!result.ok || seen.has(result.value)) continue
        seen.add(result.value)
        output.push(result.value)
    }
    return output
}
