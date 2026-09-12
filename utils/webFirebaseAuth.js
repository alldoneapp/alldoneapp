export function resolveFirebaseAuthDomain({ location, hostingUrl, fallbackAuthDomain }) {
    if (!location) return fallbackAuthDomain

    const { host, hostname, protocol } = location
    const isLocalDevHost = hostname === 'localhost' || hostname === '127.0.0.1'

    // The local HTTPS dev server proxies /__/auth/* to Firebase Hosting.
    if (isLocalDevHost) {
        return protocol === 'https:' ? host : fallbackAuthDomain
    }

    try {
        const configuredHostingHost = new URL(hostingUrl).host
        if (protocol === 'https:' && host === configuredHostingHost) {
            return host
        }
    } catch (error) {
        // Keep the Firebase-provided domain when the deployment URL is unavailable or invalid.
    }

    return fallbackAuthDomain
}

export function shouldUseGoogleRedirect({ isMobile, isLocalDev, authDomain, location }) {
    if (!location || (!isMobile && !isLocalDev)) return false

    return location.protocol === 'https:' && authDomain === location.host
}
