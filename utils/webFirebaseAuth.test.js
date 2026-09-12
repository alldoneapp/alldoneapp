import { resolveFirebaseAuthDomain, shouldUseGoogleRedirect } from './webFirebaseAuth'

describe('webFirebaseAuth', () => {
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

    test('selects redirect for mobile only when the auth handler is same-origin', () => {
        expect(
            shouldUseGoogleRedirect({
                isMobile: true,
                isLocalDev: false,
                authDomain: 'my.alldone.app',
                location: productionLocation,
            })
        ).toBe(true)
        expect(
            shouldUseGoogleRedirect({
                isMobile: true,
                isLocalDev: false,
                authDomain: 'alldonealeph.firebaseapp.com',
                location: productionLocation,
            })
        ).toBe(false)
        expect(
            shouldUseGoogleRedirect({
                isMobile: false,
                isLocalDev: false,
                authDomain: 'my.alldone.app',
                location: productionLocation,
            })
        ).toBe(false)
    })
})
