import { resolveFirebaseAuthDomain, shouldUseGoogleRedirect } from './webFirebaseAuth'

describe('webFirebaseAuth', () => {
    test('uses same-origin auth for Anna only with the production backend', () => {
        const location = { host: 'anna.alldone.app', hostname: 'anna.alldone.app', protocol: 'https:' }
        expect(
            resolveFirebaseAuthDomain({
                location,
                hostingUrl: 'https://my.alldone.app',
                fallbackAuthDomain: 'alldonealeph.firebaseapp.com',
            })
        ).toBe('anna.alldone.app')
        expect(
            resolveFirebaseAuthDomain({
                location,
                hostingUrl: 'https://mystaging.alldone.app',
                fallbackAuthDomain: 'alldonestaging.firebaseapp.com',
            })
        ).toBe('alldonestaging.firebaseapp.com')
    })
    const productionLocation = {
        host: 'my.alldone.app',
        hostname: 'my.alldone.app',
        protocol: 'https:',
    }

    test('uses the Firebase Hosting custom domain for a same-origin auth handler', () => {
        expect(
            resolveFirebaseAuthDomain({
                location: productionLocation,
                hostingUrl: 'https://my.alldone.app',
                fallbackAuthDomain: 'alldonealeph.firebaseapp.com',
            })
        ).toBe('my.alldone.app')
    })

    test('keeps the Firebase-provided auth domain on an unconfigured host', () => {
        expect(
            resolveFirebaseAuthDomain({
                location: { ...productionLocation, host: 'preview.example.com', hostname: 'preview.example.com' },
                hostingUrl: 'https://my.alldone.app',
                fallbackAuthDomain: 'alldonealeph.firebaseapp.com',
            })
        ).toBe('alldonealeph.firebaseapp.com')
    })

    test('uses the proxied auth handler only on the HTTPS local dev server', () => {
        const fallbackAuthDomain = 'alldonestaging.firebaseapp.com'

        expect(
            resolveFirebaseAuthDomain({
                location: { host: 'localhost:8080', hostname: 'localhost', protocol: 'https:' },
                hostingUrl: 'https://mystaging.alldone.app',
                fallbackAuthDomain,
            })
        ).toBe('localhost:8080')
        expect(
            resolveFirebaseAuthDomain({
                location: { host: 'localhost:8080', hostname: 'localhost', protocol: 'http:' },
                hostingUrl: 'https://mystaging.alldone.app',
                fallbackAuthDomain,
            })
        ).toBe(fallbackAuthDomain)
    })

    test('selects the same-window redirect on every device when the auth handler is same-origin (AT-2919)', () => {
        expect(shouldUseGoogleRedirect({ authDomain: 'my.alldone.app', location: productionLocation })).toBe(true)
        // The old mobile-only arguments no longer decide anything: desktop redirects too.
        expect(
            shouldUseGoogleRedirect({
                isMobile: false,
                isLocalDev: false,
                authDomain: 'my.alldone.app',
                location: productionLocation,
            })
        ).toBe(true)
        expect(
            shouldUseGoogleRedirect({
                authDomain: 'localhost:8080',
                location: { host: 'localhost:8080', hostname: 'localhost', protocol: 'https:' },
            })
        ).toBe(true)
    })

    test('keeps the popup fallback where a redirect cannot complete', () => {
        // Cross-origin handler: partitioned third-party storage loses the redirect result.
        expect(
            shouldUseGoogleRedirect({ authDomain: 'alldonealeph.firebaseapp.com', location: productionLocation })
        ).toBe(false)
        // Plain HTTP (local dev without the HTTPS server).
        expect(
            shouldUseGoogleRedirect({
                authDomain: 'localhost:8080',
                location: { host: 'localhost:8080', hostname: 'localhost', protocol: 'http:' },
            })
        ).toBe(false)
        expect(shouldUseGoogleRedirect({ authDomain: 'my.alldone.app', location: null })).toBe(false)
        expect(shouldUseGoogleRedirect({ authDomain: undefined, location: productionLocation })).toBe(false)
    })
})
