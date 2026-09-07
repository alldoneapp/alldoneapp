'use strict'

// The allowlist rule exists twice — once in the worker/policy half (`browserAllowlist.js`) and once
// in the editor the user types into (`utils/browserAllowlistInput.js`) — because Cloud Functions
// code cannot be imported into the web bundle. Two copies of a rule drift; this is the ratchet that
// says when.
//
// The contract is deliberately one-directional, because the two sides answer slightly different
// questions. The server asks "is this usable"; the editor asks "should I let the user save this".
//
//   1. client ACCEPTS  ⇒  server accepts, and normalizes to the SAME entry.
//      Without this an entry saves, shows as allowed, and is silently dropped at browse time —
//      which looks exactly like the allowlist being ignored.
//   2. server REJECTS  ⇒  client rejects.
//      The editor may be stricter (it refuses `ftp://…` outright rather than discarding the
//      scheme), but it may never be looser.

const path = require('path')

const {
    ACCESS_MODE_ALL_PUBLIC,
    ACCESS_MODE_SELECTED,
    normalizeAccessMode,
    normalizeAllowlistEntry,
} = require('./browserAllowlist')

// The web module is ESM; jest transforms it through the root babel config like any other app file.
const {
    BROWSER_ACCESS_MODE_ALL_PUBLIC,
    BROWSER_ACCESS_MODE_SELECTED,
    normalizeBrowserAccessMode,
    validateAllowlistEntry,
} = require(path.join(__dirname, '..', '..', '..', 'utils', 'browserAllowlistInput.js'))

function serverNormalized(entry) {
    const parsed = normalizeAllowlistEntry(entry)
    if (!parsed) return null
    return `${parsed.subdomainsOnly ? '*.' : ''}${parsed.host}${parsed.pathPrefix || ''}`
}

const CORPUS = [
    // ordinary
    'eventim.de',
    'www.eventim.de',
    '*.eventim.de',
    'eventim.de/city/berlin',
    'eventim.de/city/berlin/',
    'https://www.eventim.de/city/berlin/',
    'http://example.com',
    'EXAMPLE.COM',
    'example.com.',
    'sub.domain.example.co.uk',
    'xn--bcher-kva.example',
    // rejected by both
    '',
    '   ',
    '*',
    '*.',
    'com',
    'intranet',
    'localhost',
    'printer.local',
    'db.internal',
    'metadata.google.internal',
    '127.0.0.1',
    '10.0.0.5',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '8.8.8.8',
    '[::1]',
    'fd00::1',
    'example.com:8443',
    'user:pass@example.com',
    'exa*mple.com',
    'exämple.com',
    'exa mple.com',
    // stricter on the client only
    'ftp://example.com',
    'file:///etc/passwd',
]

describe('allowlist parity between the editor and the policy', () => {
    it.each(CORPUS)('agrees on %p', entry => {
        const client = validateAllowlistEntry(entry, [])
        const server = serverNormalized(entry)

        if (client.ok) {
            // Rule 1: never accept something the server would drop, and never normalize differently.
            expect(server).not.toBeNull()
            expect(client.value).toBe(server)
            return
        }
        // Rule 2 is only violated when the SERVER accepts and the client does not *for a reason
        // other than being deliberately stricter about schemes*.
        if (server !== null) {
            expect(entry).toMatch(/^[a-z][a-z0-9+.-]*:\/\//i)
            expect(client.errorKey).toBe('browser_allowlist_error_scheme')
        }
    })

    it('names a reason for every rejection, so the field can explain itself', () => {
        for (const entry of CORPUS) {
            const client = validateAllowlistEntry(entry, [])
            if (client.ok) continue
            expect(client.errorKey).toMatch(/^browser_allowlist_error_/)
        }
    })

    it('refuses a duplicate against what is already stored', () => {
        expect(validateAllowlistEntry('https://Example.com/', ['example.com']).errorKey).toBe(
            'browser_allowlist_error_duplicate'
        )
    })

    it('produces entries the policy then actually allows', () => {
        // The round trip that matters: type it, store it, and a URL on that host is allowed.
        const { checkUrlAgainstAllowlist, normalizeAllowlist } = require('./browserAllowlist')
        const typed = validateAllowlistEntry('https://www.eventim.de/city/berlin', [])
        const { entries } = normalizeAllowlist([typed.value])
        expect(checkUrlAgainstAllowlist('https://www.eventim.de/city/berlin/konzert-1', entries).allowed).toBe(true)
        expect(checkUrlAgainstAllowlist('https://www.eventim.de/account', entries).allowed).toBe(false)
    })
})

describe('access-mode parity between the editor and the policy', () => {
    it('uses the same two strings on both sides', () => {
        // The mode travels as a string from the editor through Firestore to the policy and into the
        // signed worker token. A typo on either side would read as `selected` and look like the
        // setting being ignored.
        expect(BROWSER_ACCESS_MODE_SELECTED).toBe(ACCESS_MODE_SELECTED)
        expect(BROWSER_ACCESS_MODE_ALL_PUBLIC).toBe(ACCESS_MODE_ALL_PUBLIC)
    })

    it.each([undefined, null, '', 'selected', 'all_public', 'ALL_PUBLIC', 'all public', 'everything', 0, {}])(
        'agrees on how to read %p',
        value => {
            expect(normalizeBrowserAccessMode(value)).toBe(normalizeAccessMode(value))
        }
    )

    it('never widens on an unknown value on either side', () => {
        for (const value of ['anything', 'public', 'ALL', true]) {
            expect(normalizeBrowserAccessMode(value)).toBe(ACCESS_MODE_SELECTED)
            expect(normalizeAccessMode(value)).toBe(ACCESS_MODE_SELECTED)
        }
    })
})
