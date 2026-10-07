import {
    getFirebaseAuthEmulatorUrl,
    getFirebaseFunctionsEndpoint,
    shouldUseFirebaseEmulators,
} from './firebaseEmulators'

afterEach(() => {
    delete window.Capacitor
})

it.each([
    'https://localhost:19006',
    'http://localhost:19006',
    'https://127.0.0.1:19006',
    'http://[::1]:19006',
    'https://localhost:19006/?emulator=false',
])('keeps browser development on local services: %s', url => {
    expect(shouldUseFirebaseEmulators(new URL(url))).toBe(true)
})

it.each([
    'https://mystaging.alldone.app',
    'https://my.alldone.app',
    'https://anna.alldone.app',
    'capacitor://localhost',
    'https://my.alldone.app/?other-emulator=true',
])('preserves the configured backend outside browser localhost: %s', url => {
    expect(shouldUseFirebaseEmulators(new URL(url))).toBe(false)
})

it('preserves the explicit emulator opt-in on other browser hosts', () => {
    expect(shouldUseFirebaseEmulators(new URL('http://dev.alldone.test/?emulator=true'))).toBe(true)
})

it('does not reroute a native Capacitor shell whose origin is https localhost', () => {
    window.Capacitor = { isNativePlatform: () => true }
    expect(shouldUseFirebaseEmulators(new URL('https://localhost'))).toBe(false)
})

it('handles missing browser context', () => {
    expect(shouldUseFirebaseEmulators(null)).toBe(false)
})

it.each(['https://localhost:19006/login', 'http://127.0.0.1:19006/login', 'https://[::1]:19006/login'])(
    'keeps the Auth redirect handler, iframe and token requests on the app origin: %s',
    url => {
        const location = new URL(url)
        expect(getFirebaseAuthEmulatorUrl(location)).toBe(location.origin)
    }
)

it('retains the direct emulator endpoint for an explicit opt-in outside the local dev server', () => {
    expect(getFirebaseAuthEmulatorUrl(new URL('https://preview.example.com/?emulator=true'))).toBe(
        'http://127.0.0.1:9099'
    )
})

it.each(['https://localhost:19006', 'http://127.0.0.1:19006', 'https://[::1]:19006'])(
    'routes callables through the same-origin local proxy: %s',
    url => {
        expect(getFirebaseFunctionsEndpoint('local-project', 'europe-west1', new URL(url))).toBe(
            `${url}/emulator/functions/local-project/europe-west1`
        )
    }
)

it('keeps hosted/native callables regional and explicit remote emulator opt-ins direct', () => {
    expect(getFirebaseFunctionsEndpoint('project', 'europe-west1', new URL('https://my.alldone.app'))).toBe(
        'europe-west1'
    )
    expect(
        getFirebaseFunctionsEndpoint('project', 'europe-west1', new URL('https://preview.example.com/?emulator=true'))
    ).toBe('http://127.0.0.1:5001/project/europe-west1')
    window.Capacitor = { isNativePlatform: () => true }
    expect(getFirebaseFunctionsEndpoint('project', 'europe-west1', new URL('https://localhost'))).toBe('europe-west1')
})
