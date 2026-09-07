'use strict'

const {
    ACCESS_MODE_ALL_PUBLIC,
    ACCESS_MODE_SELECTED,
    buildBrowsingPolicy,
    checkUrlAgainstAllowlist,
    normalizeAccessMode,
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

describe('access modes', () => {
    const selected = buildBrowsingPolicy({
        mode: ACCESS_MODE_SELECTED,
        allowlist: normalizeAllowlist(['tickets.example']).entries,
    })
    const allPublic = buildBrowsingPolicy({ mode: ACCESS_MODE_ALL_PUBLIC })

    describe('normalizeAccessMode', () => {
        it('only ever answers all_public for the exact string', () => {
            expect(normalizeAccessMode('all_public')).toBe(ACCESS_MODE_ALL_PUBLIC)
            expect(normalizeAccessMode('selected')).toBe(ACCESS_MODE_SELECTED)
        })

        it('falls back to selected for anything else, which is the fail-closed direction', () => {
            // A corrupt document, a typo, an older client, a future mode name: all of them have to
            // land on "only the hosts somebody listed", never on "the whole internet".
            for (const value of [undefined, null, '', 'ALL_PUBLIC', 'all public', 'everything', 42, {}, true]) {
                expect(normalizeAccessMode(value)).toBe(ACCESS_MODE_SELECTED)
            }
        })
    })

    describe('selected (the default)', () => {
        it('still refuses a host nobody listed', () => {
            expect(checkUrlAgainstAllowlist('https://elsewhere.example/', selected).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://tickets.example/', selected).allowed).toBe(true)
        })

        it('is what an empty policy means', () => {
            expect(checkUrlAgainstAllowlist('https://example.com/', buildBrowsingPolicy({})).allowed).toBe(false)
        })
    })

    describe('all_public', () => {
        it('opens an ordinary public host that is on no list at all', () => {
            const result = checkUrlAgainstAllowlist('https://www.eventim.de/city/berlin', allPublic)
            expect(result.allowed).toBe(true)
            expect(result.allPublic).toBe(true)
            expect(result.matchedEntry).toBeNull()
        })

        it.each([
            ['http://localhost:3000/', 'private_host'],
            ['http://127.0.0.1/', 'private_host'],
            ['http://127.1.2.3/', 'private_host'],
            ['http://10.1.2.3/admin', 'private_host'],
            ['http://172.16.4.5/', 'private_host'],
            ['http://192.168.0.1/', 'private_host'],
            ['http://100.64.3.2/', 'private_host'],
            ['http://169.254.169.254/computeMetadata/v1/', 'private_host'],
            ['http://metadata.google.internal/computeMetadata/v1/', 'private_host'],
            ['http://metadata/', 'private_host'],
            ['http://[::1]/', 'private_host'],
            ['http://[fd00::1]/', 'private_host'],
            ['http://[fe80::1]/', 'private_host'],
            ['http://[::ffff:127.0.0.1]/', 'private_host'],
            ['http://8.8.8.8/', 'private_host'],
            ['http://intranet/', 'private_host'],
            ['http://wiki.internal/', 'private_host'],
            ['http://printer.local/', 'private_host'],
            ['http://db.home.arpa/', 'private_host'],
            ['file:///etc/passwd', 'unsupported_scheme'],
            ['data:text/html,<h1>x', 'unsupported_scheme'],
            ['javascript:alert(1)', 'unsupported_scheme'],
            ['ftp://example.com/', 'unsupported_scheme'],
            ['https://user:pw@example.com/', 'credentials_in_url'],
        ])('still refuses %s', (url, reason) => {
            // This is the whole promise of the mode: "all PUBLIC websites", not "all addresses".
            const result = checkUrlAgainstAllowlist(url, allPublic)
            expect(result.allowed).toBe(false)
            expect(result.reason).toBe(reason)
        })

        it('keeps the LinkedIn block, which is about login walls rather than about the mode', () => {
            expect(checkUrlAgainstAllowlist('https://www.linkedin.com/in/someone', allPublic).reason).toBe(
                'blocked_host'
            )
        })
    })

    describe('denylist', () => {
        const withDenylist = mode =>
            buildBrowsingPolicy({
                mode,
                allowlist: normalizeAllowlist(['tickets.example', 'shop.example']).entries,
                denylist: normalizeAllowlist(['ads.example', '*.tracker.example', 'shop.example/admin']).entries,
            })

        it('wins over all_public', () => {
            const policy = withDenylist(ACCESS_MODE_ALL_PUBLIC)
            expect(checkUrlAgainstAllowlist('https://ads.example/', policy).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://sub.ads.example/', policy).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://beacon.tracker.example/', policy).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://anything-else.example/', policy).allowed).toBe(true)
        })

        it('wins over an explicit allowlist entry too', () => {
            // Checked before the mode, so it means the same thing in both. A denylist that only
            // worked in one mode would be read as an all_public-only feature.
            const policy = withDenylist(ACCESS_MODE_SELECTED)
            expect(checkUrlAgainstAllowlist('https://shop.example/admin/users', policy).allowed).toBe(false)
            expect(checkUrlAgainstAllowlist('https://shop.example/products', policy).allowed).toBe(true)
        })

        it('says it was the blocked list, not a missing allowlist entry', () => {
            const result = checkUrlAgainstAllowlist('https://ads.example/', withDenylist(ACCESS_MODE_ALL_PUBLIC))
            expect(result.message).toMatch(/blocked list/i)
            expect(result.deniedByEntry).toBeTruthy()
        })
    })

    describe('the legacy call shape', () => {
        it('reads a bare entry array as selected', () => {
            const entries = normalizeAllowlist(['tickets.example']).entries
            expect(checkUrlAgainstAllowlist('https://tickets.example/', entries).allowed).toBe(true)
            expect(checkUrlAgainstAllowlist('https://elsewhere.example/', entries).allowed).toBe(false)
        })
    })
})
