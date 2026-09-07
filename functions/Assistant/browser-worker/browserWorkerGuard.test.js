'use strict'

// The two worker rules that can be checked without a browser, and that are worth checking because
// they are the ones Cloud Functions structurally cannot enforce: a redirect hop or a page-initiated
// navigation never passes through the policy, so if the guard here is wrong the allowlist is
// decorative.
//
// Everything else in the worker (Playwright itself, the describe step, the snapshot) needs a real
// Chromium and is deliberately NOT faked here: a fake page object would only assert that this file
// calls the methods this file calls.

jest.mock(
    'playwright',
    () => ({
        chromium: {
            launch: async () => {
                throw new Error('playwright is not available in the test environment')
            },
        },
    }),
    { virtual: true }
)

const { requireShared } = require('./sharedModules')
const { isUrlAllowed } = require('./browserActions')
const { mintWorkerToken } = require('../browser/browserWorkerClient')
const { buildBrowsingPolicy, normalizeAllowlist } = require('../browser/browserAllowlist')

const SECRET = 'worker-secret'
const NOW = 1_800_000_000_000

describe('browser worker guard', () => {
    it('loads the shared modules from the repository layout as well as the image layout', () => {
        // The Dockerfile copies them to ./shared; the repo has them at ../browser. A worker that
        // only resolves the image layout cannot be tested at all.
        expect(typeof requireShared('browserWorkerClient').verifyWorkerToken).toBe('function')
        expect(typeof requireShared('browserAllowlist').hostMatchesEntry).toBe('function')
    })

    describe('isUrlAllowed', () => {
        const allowlist = buildBrowsingPolicy({
            mode: 'selected',
            allowlist: normalizeAllowlist(['tickets.example', '*.shop.example', 'news.example/events']).entries,
        })

        it.each([
            ['https://tickets.example/event/42', true],
            ['https://sub.tickets.example/', true],
            ['https://shop.example/', false],
            ['https://de.shop.example/cart', true],
            ['https://news.example/events/2026', true],
            ['https://news.example/account', false],
            ['https://tracker.example/pixel', false],
            ['http://tickets.example/', true],
            ['ftp://tickets.example/', false],
            ['about:blank', false],
            ['not a url', false],
        ])('answers %s with %s', (url, expected) => {
            expect(isUrlAllowed(url, allowlist)).toBe(expected)
        })

        it('denies everything when the token carried no allowlist', () => {
            expect(isUrlAllowed('https://tickets.example/', [])).toBe(false)
            expect(isUrlAllowed('https://tickets.example/', undefined)).toBe(false)
        })
    })

    describe('isUrlAllowed in all_public', () => {
        // The guard is the ONLY check a redirect hop and a page-initiated navigation ever meet, so
        // in this mode it is the only thing between a redirect and the metadata server.
        const allPublic = buildBrowsingPolicy({ mode: 'all_public' })

        it('lets an ordinary public host through', () => {
            expect(isUrlAllowed('https://www.eventim.de/city/berlin', allPublic)).toBe(true)
            expect(isUrlAllowed('http://unlisted.example/anything', allPublic)).toBe(true)
        })

        it.each([
            'http://localhost/',
            'http://127.0.0.1/',
            'http://10.0.0.1/',
            'http://172.20.1.1/',
            'http://192.168.1.1/',
            'http://100.64.0.1/',
            'http://169.254.169.254/computeMetadata/v1/token',
            'http://metadata.google.internal/',
            'http://metadata/',
            'http://[::1]/',
            'http://[fd12:3456::1]/',
            'http://[fe80::1]/',
            'http://8.8.8.8/',
            'http://intranet/',
            'http://vault.internal/',
            'http://nas.local/',
            'file:///etc/passwd',
            'data:text/html,<h1>x',
            'ftp://example.com/',
            'https://user:pw@example.com/',
        ])('refuses %s', url => {
            expect(isUrlAllowed(url, allPublic)).toBe(false)
        })

        it('refuses a denylisted public host', () => {
            const policy = buildBrowsingPolicy({
                mode: 'all_public',
                denylist: normalizeAllowlist(['ads.example', '*.tracker.example']).entries,
            })
            expect(isUrlAllowed('https://ads.example/x', policy)).toBe(false)
            expect(isUrlAllowed('https://beacon.tracker.example/', policy)).toBe(false)
            expect(isUrlAllowed('https://news.example/', policy)).toBe(true)
        })
    })

    describe('the token the worker is driven by', () => {
        const { verifyWorkerToken } = requireShared('browserWorkerClient')

        it('carries the allowlist and the limits, so the caller cannot widen them', () => {
            const allowlist = normalizeAllowlist(['tickets.example']).entries
            const token = mintWorkerToken(
                {
                    runId: 'run1',
                    sessionId: 'sess1',
                    projectId: 'p1',
                    userId: 'u1',
                    allowlist,
                    limits: { maxNetworkRequests: 250, maxResponseBytes: 100 },
                    expiresAtMs: NOW + 60000,
                },
                SECRET
            )
            const verified = verifyWorkerToken(token, SECRET, NOW)
            expect(verified.valid).toBe(true)
            expect(verified.sessionId).toBe('sess1')
            const policy = buildBrowsingPolicy({
                mode: verified.accessMode,
                allowlist: verified.allowlist,
                denylist: verified.denylist,
            })
            expect(isUrlAllowed('https://tickets.example/', policy)).toBe(true)
            expect(isUrlAllowed('https://elsewhere.example/', policy)).toBe(false)
        })

        it('carries the access mode, and defaults it to selected when it is absent', () => {
            const bare = verifyWorkerToken(
                mintWorkerToken({ runId: 'r', sessionId: 's', expiresAtMs: NOW + 1000 }, SECRET),
                SECRET,
                NOW
            )
            expect(bare.accessMode).toBe('selected')

            const wide = verifyWorkerToken(
                mintWorkerToken(
                    { runId: 'r', sessionId: 's', accessMode: 'all_public', expiresAtMs: NOW + 1000 },
                    SECRET
                ),
                SECRET,
                NOW
            )
            expect(wide.accessMode).toBe('all_public')
        })

        it('cannot have its MODE edited without breaking the signature', () => {
            // The client-side bypass this closes: "all public websites" is a signed claim, not a
            // request parameter, so nothing that merely talks to the worker can assert it.
            const token = mintWorkerToken(
                {
                    runId: 'r',
                    sessionId: 's',
                    allowlist: normalizeAllowlist(['tickets.example']).entries,
                    expiresAtMs: NOW + 1000,
                },
                SECRET
            )
            const [payload, signature] = token.replace('abw_', '').split('.')
            const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
            decoded.mode = 'all_public'
            const forged = `abw_${Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')}.${signature}`
            expect(verifyWorkerToken(forged, SECRET, NOW).reason).toBe('signature')
        })

        it('cannot have its DENYLIST edited away without breaking the signature', () => {
            const token = mintWorkerToken(
                {
                    runId: 'r',
                    sessionId: 's',
                    accessMode: 'all_public',
                    denylist: normalizeAllowlist(['ads.example']).entries,
                    expiresAtMs: NOW + 1000,
                },
                SECRET
            )
            const [payload, signature] = token.replace('abw_', '').split('.')
            const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
            decoded.deny = []
            const forged = `abw_${Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')}.${signature}`
            expect(verifyWorkerToken(forged, SECRET, NOW).reason).toBe('signature')
        })

        it('rejects a tampered, foreign-signed or expired token', () => {
            const token = mintWorkerToken({ runId: 'r', sessionId: 's', expiresAtMs: NOW + 1000 }, SECRET)
            expect(verifyWorkerToken(token, SECRET, NOW).valid).toBe(true)
            expect(verifyWorkerToken(`${token}x`, SECRET, NOW).valid).toBe(false)
            expect(verifyWorkerToken(token, 'another-secret', NOW).valid).toBe(false)
            expect(verifyWorkerToken(token, SECRET, NOW + 2000).reason).toBe('expired')
            expect(verifyWorkerToken(token, '', NOW).reason).toBe('no_secret')
            expect(verifyWorkerToken('not-a-token', SECRET, NOW).reason).toBe('format')
        })

        it('cannot have its allowlist edited without breaking the signature', () => {
            const token = mintWorkerToken(
                {
                    runId: 'r',
                    sessionId: 's',
                    allowlist: normalizeAllowlist(['tickets.example']).entries,
                    expiresAtMs: NOW + 1000,
                },
                SECRET
            )
            const [payload, signature] = token.replace('abw_', '').split('.')
            const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
            decoded.allow.push({ h: 'evil.example', s: false, p: '' })
            const forged = `abw_${Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')}.${signature}`
            expect(verifyWorkerToken(forged, SECRET, NOW).reason).toBe('signature')
        })
    })
})
