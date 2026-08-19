// Detection and native-bridge access for the Capacitor iOS shell (ios-app/).
// The web bundle deliberately has NO npm dependency on Capacitor: inside the
// shell the native runtime injects `window.Capacitor` and exposes every
// registered native plugin on `window.Capacitor.Plugins`, which is all we
// need. In a normal browser these helpers are inert and return false/null, so
// call sites can branch on them without their own environment checks.

export function isCapacitorShell() {
    if (typeof window === 'undefined') return false
    const cap = window.Capacitor
    return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform())
}

function getShellPlugin(name) {
    if (!isCapacitorShell()) return null
    const plugins = window.Capacitor.Plugins
    return (plugins && plugins[name]) || null
}

// @capacitor-firebase/authentication, configured with skipNativeAuth so the
// web Firebase SDK stays the single owner of the auth session. Null outside
// the shell or if the native plugin is missing from the build.
export function getNativeGoogleAuthPlugin() {
    return getShellPlugin('FirebaseAuthentication')
}
