import { isCapacitorShell, getNativeGoogleAuthPlugin } from './CapacitorShell'

describe('CapacitorShell', () => {
    afterEach(() => {
        delete window.Capacitor
    })

    it('is inert in a plain browser (no window.Capacitor)', () => {
        expect(isCapacitorShell()).toBe(false)
        expect(getNativeGoogleAuthPlugin()).toBe(null)
    })

    it('ignores the Capacitor global when not a native platform (web plugin shim)', () => {
        window.Capacitor = { isNativePlatform: () => false, Plugins: { FirebaseAuthentication: {} } }
        expect(isCapacitorShell()).toBe(false)
        expect(getNativeGoogleAuthPlugin()).toBe(null)
    })

    it('exposes the native auth plugin inside the shell', () => {
        const plugin = { signInWithGoogle: jest.fn() }
        window.Capacitor = { isNativePlatform: () => true, Plugins: { FirebaseAuthentication: plugin } }
        expect(isCapacitorShell()).toBe(true)
        expect(getNativeGoogleAuthPlugin()).toBe(plugin)
    })

    it('returns null in the shell when the plugin is missing from the native build', () => {
        window.Capacitor = { isNativePlatform: () => true, Plugins: {} }
        expect(isCapacitorShell()).toBe(true)
        expect(getNativeGoogleAuthPlugin()).toBe(null)
    })
})
