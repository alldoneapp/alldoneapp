'use strict'

const {
    checkUrlAgainstAllowlist,
    isIpLiteralHostname,
    isPrivateHostname,
    normalizeAllowlist,
    normalizeAllowlistEntry,
} = require('./browserAllowlist')

describe('browser allowlist', () => {
    describe('default deny', () => {
        it('refuses every URL when nothing is allowlisted', () => {
            const result = checkUrlAgainstAllowlist('https://eventim.de/event/123', [])
            expect(result.allowed).toBe(false)
            expect(result.reason).toBe('not_allowlisted')
            // The message has to say WHY nothing is allowed, or an operator reads it as the site
            // being unreachable and goes looking in the wrong place.
            expect(result.message).toMatch(/allowlist is empty/i)
        })

        it('refuses a host that is merely similar to an allowlisted one', () => {
            const { entries } = normalizeAllowlist(['eventim.de'])
            expect(checkUrlAgainstAllowlist('https://eventim.de.evil.com/', entries).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://noteventim.de/', entries).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://eventim.de/x', entries).allowed).toBe(true)
        })
    })

    describe('entry normalization', () => {
        it('accepts a pasted URL and keeps only the host', () => {
            expect(normalizeAllowlistEntry('https://www.eventim.de/city/berlin/')).toEqual({
                host: 'www.eventim.de',
                subdomainsOnly: false,
                pathPrefix: '/city/berlin',
            })
        })

        it('matches subdomains for a bare entry and excludes the apex for a *. entry', () => {
            const bare = normalizeAllowlist(['example.com']).entries
            expect(checkUrlAgainstAllowlist('https://example.com/', bare).allowed).toBe(true)
            expect(checkUrlAgainstAllowlist('https://shop.example.com/', bare).allowed).toBe(true)

            const wildcard = normalizeAllowlist(['*.example.com']).entries
            expect(checkUrlAgainstAllowlist('https://example.com/', wildcard).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://shop.example.com/', wildcard).allowed).toBe(true)
        })

        it('enforces a configured path prefix', () => {
            const entries = normalizeAllowlist(['example.com/events']).entries
            expect(checkUrlAgainstAllowlist('https://example.com/events/42', entries).allowed).toBe(true)
            expect(checkUrlAgainstAllowlist('https://example.com/eventsomething', entries).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://example.com/account', entries).allowed).toBe(false)
        })

        it('rejects the entries that would open everything, and reports them', () => {
            const { entries, rejected } = normalizeAllowlist([
                '*',
                'com',
                '127.0.0.1',
                '10.0.0.5',
                '[::1]',
                'localhost',
                'intranet',
                'metadata.google.internal',
                'user:pass@example.com',
                'example.com:8443',
                'good.example',
            ])
            expect(entries.map(entry => entry.host)).toEqual(['good.example'])
            expect(rejected).toHaveLength(10)
        })

        it('drops duplicates so a repeated entry cannot widen anything', () => {
            const { entries } = normalizeAllowlist(['example.com', 'EXAMPLE.com.', 'example.com'])
            expect(entries).toHaveLength(1)
        })
    })

    describe('addresses that must never be reachable', () => {
        it.each([
            ['localhost', true],
            ['127.0.0.1', true],
            ['127.1.2.3', true],
            ['10.11.12.13', true],
            ['172.16.0.1', true],
            ['172.32.0.1', false],
            ['192.168.1.1', true],
            ['169.254.169.254', true],
            ['100.64.0.1', true],
            ['0.0.0.0', true],
            ['metadata.google.internal', true],
            ['db.internal', true],
            ['printer.local', true],
            ['wiki', true],
            ['::1', true],
            ['fd00::1', true],
            ['fe80::1', true],
            ['::ffff:127.0.0.1', true],
            ['eventim.de', false],
            ['8.8.8.8', false],
        ])('classifies %s', (hostname, expected) => {
            expect(isPrivateHostname(hostname)).toBe(expected)
        })

        it('never allows an IP literal even when it is public', () => {
            // A public IP is not private, but it is still an address rather than a name and the
            // allowlist cannot express it — so it can never match an entry.
            expect(isIpLiteralHostname('8.8.8.8')).toBe(true)
            const entries = normalizeAllowlist(['example.com']).entries
            expect(checkUrlAgainstAllowlist('https://8.8.8.8/', entries).reason).toBe('private_host')
        })

        it('refuses the metadata server even if it is somehow on the list', () => {
            // It cannot get on the list (normalizeAllowlist rejects it), and it is refused again at
            // check time. Both, because either one alone is a single point of failure.
            const forced = [{ host: 'metadata.google.internal', subdomainsOnly: false, pathPrefix: '' }]
            expect(checkUrlAgainstAllowlist('http://metadata.google.internal/computeMetadata/v1/', forced).reason).toBe(
                'private_host'
            )
        })
    })

    describe('URL shapes', () => {
        const entries = normalizeAllowlist(['example.com']).entries

        it('refuses non-http schemes', () => {
            expect(checkUrlAgainstAllowlist('file:///etc/passwd', entries).reason).toBe('unsupported_scheme')
            expect(checkUrlAgainstAllowlist('javascript:alert(1)', entries).reason).toBe('unsupported_scheme')
            expect(checkUrlAgainstAllowlist('data:text/html,<h1>x', entries).reason).toBe('unsupported_scheme')
        })

        it('refuses credentials embedded in the URL', () => {
            expect(checkUrlAgainstAllowlist('https://user:secret@example.com/', entries).reason).toBe(
                'credentials_in_url'
            )
        })

        it('keeps the LinkedIn block that fetch_url already has', () => {
            const withLinkedin = normalizeAllowlist(['linkedin.com', 'example.com']).entries
            expect(checkUrlAgainstAllowlist('https://www.linkedin.com/in/someone', withLinkedin).reason).toBe(
                'blocked_host'
            )
        })
    })
})
