'use strict'

// NV-23: OAuth connect flows are bound to the browser that started them, return only to Alldone,
// and hand their result only to Alldone origins.
const fs = require('fs')
const path = require('path')
const {
    hashBrowserNonce,
    normalizeBrowserNonceHash,
    normalizeOAuthReturnUrl,
    requestMatchesBrowserBinding,
    clearBindingCookie,
    getAppOrigins,
} = require('./oauthBrowserBinding')

const NONCE = 'AbC_-123'.repeat(6)

describe('oauthBrowserBinding', () => {
    afterEach(() => {
        delete process.env.FUNCTIONS_EMULATOR
    })

    test('matches only the nonce whose hash was stored', () => {
        const hash = hashBrowserNonce(NONCE)
        expect(requestMatchesBrowserBinding({ headers: { cookie: `__session=${NONCE}` } }, hash)).toBe(true)
        expect(requestMatchesBrowserBinding({ headers: { cookie: `a=b; __session=${NONCE}; c=d` } }, hash)).toBe(true)
        expect(requestMatchesBrowserBinding({ headers: { cookie: `__session=${NONCE}x` } }, hash)).toBe(false)
        expect(requestMatchesBrowserBinding({ headers: { cookie: `other=${NONCE}` } }, hash)).toBe(false)
        expect(requestMatchesBrowserBinding({ headers: {} }, hash)).toBe(false)
        expect(requestMatchesBrowserBinding(undefined, hash)).toBe(false)
        // No stored hash (a flow from before the binding) never matches.
        expect(requestMatchesBrowserBinding({ headers: { cookie: `__session=${NONCE}` } }, null)).toBe(false)
        // The hash itself in the cookie is not the nonce.
        expect(requestMatchesBrowserBinding({ headers: { cookie: `__session=${hash}` } }, hash)).toBe(false)
    })

    test('accepts only a SHA-256 hex digest as the stored hash', () => {
        expect(normalizeBrowserNonceHash(hashBrowserNonce(NONCE).toUpperCase())).toBe(hashBrowserNonce(NONCE))
        expect(normalizeBrowserNonceHash('abc')).toBeNull()
        expect(normalizeBrowserNonceHash(undefined)).toBeNull()
    })

    test('returns only to Alldone origins, and to localhost only in the emulator', () => {
        expect(normalizeOAuthReturnUrl('https://my.alldone.app/onboarding?googleAuth=success')).toBe(
            'https://my.alldone.app/onboarding?googleAuth=success'
        )
        expect(normalizeOAuthReturnUrl('https://mystaging.alldone.app/x')).toBe('https://mystaging.alldone.app/x')
        expect(normalizeOAuthReturnUrl('https://evil.example.test/landing')).toBeNull()
        expect(normalizeOAuthReturnUrl('https://my.alldone.app.evil.test/')).toBeNull()
        expect(normalizeOAuthReturnUrl('javascript:alert(1)')).toBeNull()
        expect(normalizeOAuthReturnUrl('//evil.example.test')).toBeNull()
        expect(normalizeOAuthReturnUrl('https://localhost:19006/onboarding')).toBeNull()
        process.env.FUNCTIONS_EMULATOR = 'true'
        expect(normalizeOAuthReturnUrl('https://localhost:19006/onboarding')).toBe('https://localhost:19006/onboarding')
    })

    test('posts only to https app origins outside the emulator', () => {
        const origins = getAppOrigins()
        expect(origins).toContain('https://my.alldone.app')
        expect(origins.every(origin => origin.startsWith('https://'))).toBe(true)
        expect(origins.some(origin => origin.includes('localhost'))).toBe(false)
    })

    test('clears the binding cookie on its own path', () => {
        const headers = []
        clearBindingCookie({ append: (name, value) => headers.push([name, value]) }, '/googleOAuthCallback')
        expect(headers).toEqual([
            ['Set-Cookie', '__session=; Path=/googleOAuthCallback; Max-Age=0; Secure; HttpOnly; SameSite=Lax'],
        ])
    })
})

describe('functions/index.js wiring (NV-23)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    const exportBody = name => {
        const start = source.indexOf(`exports.${name} = `)
        expect(start).toBeGreaterThan(-1)
        return source.slice(start, source.indexOf('\n)\n', start))
    }

    test.each(['googleOAuthInitiate', 'microsoftOAuthInitiate'])('%s requires the browser binding', name => {
        const body = exportBody(name)
        expect(body).toContain('assertOAuthBrowserBindingArguments({ returnUrl, browserNonceHash })')
        expect(body).toMatch(/initiateOAuth\([^)]*browserNonceHash\)/)
    })

    test.each(['googleOAuthCallback', 'microsoftOAuthCallback'])(
        '%s checks the completing browser and never redirects to an unchecked URL',
        name => {
            const body = exportBody(name)
            expect(body).toContain('handleOAuthCallback(code, state, { request: req })')
            expect(body).toContain('normalizeOAuthReturnUrl(result.returnUrl)')
            expect(body).not.toContain('res.redirect(result.returnUrl)')
        }
    )

    test('the MCP client flow is bound to the browser too', () => {
        expect(exportBody('beginMcpOAuth')).toContain('browserNonceHash: data && data.browserNonceHash')
        expect(exportBody('mcpClientOAuthCallback')).toContain('exchangeMcpOAuthCode({ code, state, request: req })')
    })
})
