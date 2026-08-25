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

// Sign in with Apple is only offered on the iOS shell (App Store guideline
// 4.8 requires it there; nowhere else does it make sense).
export function isCapacitorIosShell() {
    if (!isCapacitorShell()) return false
    const cap = window.Capacitor
    return typeof cap.getPlatform === 'function' && cap.getPlatform() === 'ios'
}

// @revenuecat/purchases-capacitor — StoreKit purchases for the iOS shell.
// Null outside the shell or when the native plugin is missing from the build.
export function getNativePurchasesPlugin() {
    return getShellPlugin('Purchases')
}

// Local native bridge owned by ios-app/. It stores only the scoped share-
// extension capability in the shared App Group; no Firebase session material
// leaves the web view.
export function getIosShareExtensionPlugin() {
    return isCapacitorIosShell() ? getShellPlugin('IosShareExtension') : null
}

// Provisioning can overlap when auth state changes quickly. Only the newest
// attempt may publish a token to the App Group; logout invalidates every
// attempt that was already waiting on the backend.
let iosShareCredentialProvisioningGeneration = 0

export function beginIosShareCredentialProvisioning() {
    iosShareCredentialProvisioningGeneration += 1
    return iosShareCredentialProvisioningGeneration
}

export function invalidateIosShareCredentialProvisioning() {
    iosShareCredentialProvisioningGeneration += 1
}

export function isCurrentIosShareCredentialProvisioning(generation) {
    return generation === iosShareCredentialProvisioningGeneration
}
