import {
    APP_AUTH_STATE_MAX_AGE_MS,
    APP_AUTH_STATE_STORAGE_KEY,
    buildAppAuthCallbackUrl,
    captureAppAuthStateFromLocation,
    clearPendingAppAuthState,
    readPendingAppAuthState,
    resolveAppAuthReturnUrl,
    sanitizeAppAuthState,
} from './appAuthState'
import { DEFAULT_POST_LOGIN_URL, resolveLoginBootstrap } from '../LoginScreen/loginBootstrap'
import URLSystemTrigger from '../../URLSystem/URLSystemTrigger'

jest.mock('../../components/SettingsView/SettingsHelper', () => ({}))
jest.mock('../../components/TaskListView/Utils/TasksHelper', () => ({}))
jest.mock('../../utils/backends/firestore', () => ({ inProductionEnvironment: () => false }))

const VALID_STATE = 'Abc123_-xyzXYZ0987654321'
const callbackParams = url => new URLSearchParams(url.slice(url.indexOf('?') + 1))
const currentUrl = () => `${window.location.pathname}${window.location.search}`

beforeEach(() => {
    clearPendingAppAuthState()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
})

describe('sanitizeAppAuthState', () => {
    it.each([
        ['a'.repeat(16), true],
        ['a'.repeat(128), true],
        [VALID_STATE, true],
        ['a'.repeat(15), false],
        ['a'.repeat(129), false],
        ['abcdefghijklmnop=', false],
        ['abcdefghijklmnop&token=evil', false],
        ['abcdefgh ijklmnop', false],
        ['abcdefghijklmnop\n', false],
        ['', false],
        [null, false],
        [undefined, false],
        [12345678901234567, false],
    ])('%p is accepted: %p', (value, accepted) => {
        expect(sanitizeAppAuthState(value)).toBe(accepted ? value : null)
    })
})

describe('capturing the state at boot', () => {
    it('keeps a valid state for this tab and takes it out of the address bar', () => {
        window.history.replaceState(null, '', `/app-auth?state=${VALID_STATE}`)

        expect(captureAppAuthStateFromLocation()).toBe(VALID_STATE)
        expect(currentUrl()).toBe('/app-auth')
        expect(readPendingAppAuthState()).toBe(VALID_STATE)
    })

    it('keeps unrelated query parameters when it strips the state', () => {
        window.history.replaceState(null, '', `/app-auth?assistant=0&state=${VALID_STATE}#x`)
        captureAppAuthStateFromLocation()
        expect(`${currentUrl()}${window.location.hash}`).toBe('/app-auth?assistant=0#x')
    })

    it.each([
        'short',
        'has spaces in it but long enough',
        `${VALID_STATE}%26token%3Devil`,
        'a'.repeat(129),
        `${VALID_STATE}&state=${VALID_STATE}`,
    ])('drops an invalid state %p, and still removes it from the address bar', state => {
        window.history.replaceState(null, '', `/app-auth?state=${state}`)

        expect(captureAppAuthStateFromLocation()).toBeNull()
        expect(currentUrl()).toBe('/app-auth')
        expect(readPendingAppAuthState()).toBeNull()
        expect(window.sessionStorage.getItem(APP_AUTH_STATE_STORAGE_KEY)).toBeNull()
    })

    it('forgets an earlier state when an older Anna opens the page without one', () => {
        window.history.replaceState(null, '', `/app-auth?state=${VALID_STATE}`)
        captureAppAuthStateFromLocation()

        window.history.replaceState(null, '', '/app-auth')
        captureAppAuthStateFromLocation()

        expect(readPendingAppAuthState()).toBeNull()
    })

    it('does nothing on any other page', () => {
        window.history.replaceState(null, '', `/projects/tasks/open?state=${VALID_STATE}`)
        expect(captureAppAuthStateFromLocation()).toBeNull()
        expect(currentUrl()).toBe(`/projects/tasks/open?state=${VALID_STATE}`)
        expect(readPendingAppAuthState()).toBeNull()
    })

    it('expires with Anna, after ten minutes', () => {
        window.history.replaceState(null, '', `/app-auth?state=${VALID_STATE}`)
        captureAppAuthStateFromLocation({ now: 1000 })

        expect(readPendingAppAuthState(window.sessionStorage, 1000 + APP_AUTH_STATE_MAX_AGE_MS)).toBe(VALID_STATE)
        expect(readPendingAppAuthState(window.sessionStorage, 1001 + APP_AUTH_STATE_MAX_AGE_MS)).toBeNull()
        expect(window.sessionStorage.getItem(APP_AUTH_STATE_STORAGE_KEY)).toBeNull()
    })

    it('never trusts a tampered stored value', () => {
        window.sessionStorage.setItem(
            APP_AUTH_STATE_STORAGE_KEY,
            JSON.stringify({ state: 'abc&token=evil-and-long', savedAt: Date.now() })
        )
        expect(readPendingAppAuthState()).toBeNull()
    })
})

describe('the callback to Anna', () => {
    const user = { token: 'tok en', email: 'a@b.c', name: 'Karsten W', gold: 42 }

    it('appends the state and leaves every existing parameter as it was', () => {
        const url = buildAppAuthCallbackUrl({ ...user, state: VALID_STATE })
        expect(url).toBe(
            `hybridmeetingguard://auth?provider=alldone-app&token=tok%20en&email=a%40b.c&name=Karsten%20W&gold=42&state=${VALID_STATE}`
        )
    })

    it('is byte-identical to the old callback when there is no state (older Anna builds)', () => {
        expect(buildAppAuthCallbackUrl(user)).toBe(
            'hybridmeetingguard://auth?provider=alldone-app&token=tok%20en&email=a%40b.c&name=Karsten%20W&gold=42'
        )
    })

    it('never forwards an invalid state', () => {
        const url = buildAppAuthCallbackUrl({ ...user, state: 'abc&token=evil-and-long' })
        expect(callbackParams(url).has('state')).toBe(false)
        expect(callbackParams(url).getAll('token')).toEqual(['tok en'])
    })
})

describe('surviving the login detour', () => {
    it('a popup login keeps /app-auth as its destination, without the state in initialUrl', () => {
        window.history.replaceState(null, '', `/app-auth?state=${VALID_STATE}`)
        captureAppAuthStateFromLocation()

        // The login screen reads the address bar after boot, i.e. after the capture stripped it.
        const { initialUrl } = resolveLoginBootstrap(window.location.pathname, window.location.search)
        expect(initialUrl).toBe('/app-auth')
        expect(URLSystemTrigger.match(initialUrl).key).toBe('APP_AUTH')
        expect(readPendingAppAuthState()).toBe(VALID_STATE)
    })

    it('a Google redirect login comes back to /login, is sent to /app-auth, and still has the state', () => {
        window.history.replaceState(null, '', `/app-auth?state=${VALID_STATE}`)
        captureAppAuthStateFromLocation()
        // The login screen rewrites the address bar, then the page leaves for Google and reloads.
        window.history.replaceState(null, '', '/login')

        jest.isolateModules(() => {
            // A fresh module instance: nothing survives in memory, only sessionStorage.
            const reloaded = require('./appAuthState')
            const { resolveLoginBootstrap: reloadedBootstrap } = require('../LoginScreen/loginBootstrap')

            expect(reloaded.captureAppAuthStateFromLocation()).toBeNull() // not on /app-auth: untouched
            expect(reloadedBootstrap('/login', '').initialUrl).toBe('/app-auth')
            expect(reloaded.resolveAppAuthReturnUrl('/login')).toBe('/app-auth')
            expect(reloaded.readPendingAppAuthState()).toBe(VALID_STATE)

            const callback = reloaded.buildAppAuthCallbackUrl({
                token: 't',
                email: 'e',
                name: 'n',
                gold: 1,
                state: reloaded.readPendingAppAuthState(),
            })
            expect(callbackParams(callback).get('state')).toBe(VALID_STATE)
        })
    })

    it('an ordinary login without a pending Anna sign-in is unchanged', () => {
        expect(resolveAppAuthReturnUrl('/login')).toBeNull()
        expect(resolveLoginBootstrap('/login', '').initialUrl).toBe(DEFAULT_POST_LOGIN_URL)
    })

    it('an invalid state never routes a login back to /app-auth', () => {
        window.history.replaceState(null, '', '/app-auth?state=too-short')
        captureAppAuthStateFromLocation()
        window.history.replaceState(null, '', '/login')
        expect(resolveLoginBootstrap('/login', '').initialUrl).toBe(DEFAULT_POST_LOGIN_URL)
    })

    it('only a login entry is redirected, never a deep link', () => {
        window.history.replaceState(null, '', `/app-auth?state=${VALID_STATE}`)
        captureAppAuthStateFromLocation()
        expect(resolveAppAuthReturnUrl('/projects/p1/notes/n1')).toBeNull()
    })
})
