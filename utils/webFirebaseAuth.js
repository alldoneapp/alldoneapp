export function resolveFirebaseAuthDomain({ location, hostingUrl, fallbackAuthDomain }) {
    if (!location) return fallbackAuthDomain

    const { host, hostname, protocol } = location
    const isLocalDevHost = hostname === 'localhost' || hostname === '127.0.0.1'

    // Local Auth runs through the dev server's same-origin emulator proxy.
    if (isLocalDevHost) {
        return protocol === 'https:' ? host : fallbackAuthDomain
    }

    try {
        const configuredHostingHost = new URL(hostingUrl).host
        if (
            protocol === 'https:' &&
            (host === configuredHostingHost ||
                (hostname === 'anna.alldone.app' && configuredHostingHost === 'my.alldone.app'))
        ) {
            return host
        }
    } catch (error) {
        // Keep the Firebase-provided domain when the deployment URL is unavailable or invalid.
    }

    return fallbackAuthDomain
}

// Google sign-in stays in the same window wherever Firebase's auth handler is same-origin
// (AT-2919): desktop as well as mobile. A cross-origin handler (*.firebaseapp.com) cannot
// complete a redirect in browsers that partition third-party storage (Safari 16.1+, Firefox
// 109+, Chrome with storage partitioning), so only those hosts keep the popup fallback.
export function shouldUseGoogleRedirect({ authDomain, location }) {
    if (!location || !authDomain) return false

    return location.protocol === 'https:' && authDomain === location.host
}
