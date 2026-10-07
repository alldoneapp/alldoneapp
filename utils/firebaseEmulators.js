import { isCapacitorShell } from './CapacitorShell'

const isLocalBrowser = location =>
    location &&
    !isCapacitorShell() &&
    ['http:', 'https:'].includes(location.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)

// Capacitor also uses localhost for its bundled app. Only browser development
// should switch automatically; hosted builds keep their configured backend.
export const shouldUseFirebaseEmulators = (location = typeof window === 'undefined' ? null : window.location) => {
    if (!location) return false
    if (new URLSearchParams(location.search).get('emulator') === 'true') return true
    return !!isLocalBrowser(location)
}

// The redirect handler stores its result in sessionStorage and the helper
// iframe reads it after returning to the app. Both must share the app's origin
// to avoid browser storage partitioning. The dev server proxies all Auth paths.
export const getFirebaseAuthEmulatorUrl = (location = typeof window === 'undefined' ? null : window.location) =>
    isLocalBrowser(location) ? location.origin : 'http://127.0.0.1:9099'
