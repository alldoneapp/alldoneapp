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
const { normalizeAllowlist } = require('../browser/browserAllowlist')

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
        const allowlist = normalizeAllowlist(['tickets.example', '*.shop.example', 'news.example/events']).entries

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
            expect(isUrlAllowed('https://tickets.example/', verified.allowlist)).toBe(true)
            expect(isUrlAllowed('https://elsewhere.example/', verified.allowlist)).toBe(false)
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
