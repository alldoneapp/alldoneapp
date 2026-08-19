/**
 * AT-2234 - "the app always reloads twice after a version update reload".
 *
 * The stored `localVersion*` keys are the only thing standing between a version
 * change and a forced reload. `deleteCacheAndRefresh` used to reload without
 * moving them, so the replacement page still looked stale to `updateVersion`
 * and reloaded a second time. These tests pin the whole loop: click the
 * refresh affordance, boot the replacement page, and assert it stays put.
 */

const mockStorage = new Map()

jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(key => Promise.resolve(mockStorage.has(key) ? mockStorage.get(key) : null)),
    setItem: jest.fn((key, value) => {
        if (typeof value !== 'string') {
            // Matches the native backend, which rejects non-string values.
            return Promise.reject(new Error(`[AsyncStorage] value for key "${key}" is not a string`))
        }
        mockStorage.set(key, value)
        return Promise.resolve()
    }),
}))

const mockStoreState = {}
jest.mock('../../redux/store', () => ({
    getState: () => mockStoreState,
    dispatch: jest.fn(),
}))

jest.mock('../../utils/BackendBridge', () => ({
    getAllDoneVersion: jest.fn(),
    watchAllDoneVersion: jest.fn(),
}))

jest.mock('../../utils/backends/Tasks/randomSomedayTask', () => ({
    selectRandomSomedayTask: jest.fn(() => Promise.resolve(null)),
}))

jest.mock('../../redux/actions', () => ({
    hideConfirmPopup: jest.fn(() => ({ type: 'hideConfirmPopup' })),
    setNewVersion: jest.fn(version => ({ type: 'setNewVersion', version })),
    setShowOptionalVersionNotification: jest.fn(value => ({ type: 'setShowOptionalVersionNotification', value })),
    setShowSideBarVersionRefresher: jest.fn(value => ({ type: 'setShowSideBarVersionRefresher', value })),
    setVersion: jest.fn(version => ({ type: 'setVersion', version })),
    showConfirmPopup: jest.fn(data => ({ type: 'showConfirmPopup', data })),
}))

const AsyncStorage = require('@react-native-async-storage/async-storage')
const defaultGetItem = AsyncStorage.getItem.getMockImplementation()
const defaultSetItem = AsyncStorage.setItem.getMockImplementation()
const Backend = require('../../utils/BackendBridge')
const {
    appReloader,
    deleteCacheAndRefresh,
    storeVersion,
    LOCAL_VERSION_STORAGE_KEYS,
    PRE_RELOAD_BUDGET_MS,
} = require('../../utils/Observers')

const V1 = { major: 1, minor: 4, patch: 0 }
const V2 = { major: 1, minor: 5, patch: 0 }

const PLACEHOLDER_VERSION = { major: 0, minor: 0, patch: 0 }

const setStoredVersion = version => {
    mockStorage.set(LOCAL_VERSION_STORAGE_KEYS.major, String(version.major))
    mockStorage.set(LOCAL_VERSION_STORAGE_KEYS.minor, String(version.minor))
    mockStorage.set(LOCAL_VERSION_STORAGE_KEYS.patch, String(version.patch))
}

const readStoredVersion = () => ({
    major: mockStorage.get(LOCAL_VERSION_STORAGE_KEYS.major),
    minor: mockStorage.get(LOCAL_VERSION_STORAGE_KEYS.minor),
    patch: mockStorage.get(LOCAL_VERSION_STORAGE_KEYS.patch),
})

/** Boots a fresh page: what `loadInitialDataForLoggedUser` does via `storeVersion()`. */
const bootPage = async serverVersion => {
    Backend.getAllDoneVersion.mockResolvedValue(serverVersion)
    storeVersion()
    // storeVersion() is fire-and-forget; drain the promise chain it starts.
    await new Promise(resolve => setImmediate(resolve))
}

let reload
const originalReload = appReloader.reload

afterAll(() => {
    appReloader.reload = originalReload
})

beforeEach(() => {
    jest.clearAllMocks()
    // clearAllMocks keeps implementations, so restore the ones a test overrode.
    AsyncStorage.setItem.mockImplementation(defaultSetItem)
    AsyncStorage.getItem.mockImplementation(defaultGetItem)
    mockStorage.clear()

    reload = jest.fn()
    appReloader.reload = reload

    mockStoreState.loggedUser = { uid: 'user-1' }
    mockStoreState.alldoneVersion = { ...PLACEHOLDER_VERSION }
    mockStoreState.alldoneNewVersion = { ...PLACEHOLDER_VERSION }
})

describe('deleteCacheAndRefresh', () => {
    it('records the pending version so the replacement page does not reload again', async () => {
        // Running v1, the watcher has announced v2 and the user clicked "Reload".
        setStoredVersion(V1)
        mockStoreState.alldoneVersion = { ...V1 }
        mockStoreState.alldoneNewVersion = { ...V2, isMandatory: false }

        await deleteCacheAndRefresh()

        expect(reload).toHaveBeenCalledTimes(1)
        expect(readStoredVersion()).toEqual({ major: '1', minor: '5', patch: '0' })

        // The replacement page boots on v2 and must NOT reload a second time.
        reload.mockClear()
        await bootPage(V2)

        expect(reload).not.toHaveBeenCalled()
    })

    it('is a no-op on the marker when no newer version is pending', async () => {
        setStoredVersion(V1)
        mockStoreState.alldoneVersion = { ...V1 }

        // e.g. the error boundary or the "start a new day" modal.
        await deleteCacheAndRefresh()

        expect(reload).toHaveBeenCalledTimes(1)
        expect(readStoredVersion()).toEqual({ major: '1', minor: '4', patch: '0' })
    })

    it('leaves the marker alone when nothing usable is known yet', async () => {
        setStoredVersion(V1)
        // Both redux versions are still the 0.0.0 placeholder.

        await deleteCacheAndRefresh()

        expect(reload).toHaveBeenCalledTimes(1)
        expect(readStoredVersion()).toEqual({ major: '1', minor: '4', patch: '0' })
    })

    it('ignores the press event that onPress handlers pass in', async () => {
        setStoredVersion(V1)
        mockStoreState.alldoneVersion = { ...V1 }
        mockStoreState.alldoneNewVersion = { ...V2 }

        await deleteCacheAndRefresh({ nativeEvent: { pageX: 10, pageY: 20 } })

        expect(readStoredVersion()).toEqual({ major: '1', minor: '5', patch: '0' })
    })

    it('still reloads when storage is unavailable', async () => {
        setStoredVersion(V1)
        mockStoreState.alldoneNewVersion = { ...V2 }
        AsyncStorage.setItem.mockRejectedValue(new Error('storage disabled'))

        await deleteCacheAndRefresh()

        expect(reload).toHaveBeenCalledTimes(1)
    })

    /**
     * AT-2367 — the pre-reload housekeeping is best effort, but it is also
     * unbounded network work: `selectRandomSomedayTask` runs one sequential
     * Firestore query per project (78 on the dogfooding account) and
     * `deleteCache` awaits the service worker update fetch. On mobile that is
     * what made "Start new day" feel like it did nothing for half a minute.
     */
    it('reloads within the budget even when the pre-reload work never settles', async () => {
        jest.useFakeTimers()
        const somedayTask = require('../../utils/backends/Tasks/randomSomedayTask')
        somedayTask.selectRandomSomedayTask.mockImplementation(() => new Promise(() => {}))

        const refreshed = deleteCacheAndRefresh()

        // Let the (resolved) version-marker writes drain, then burn the budget.
        await Promise.resolve()
        await Promise.resolve()
        jest.advanceTimersByTime(PRE_RELOAD_BUDGET_MS)
        await refreshed

        expect(reload).toHaveBeenCalledTimes(1)
        jest.useRealTimers()
        somedayTask.selectRandomSomedayTask.mockImplementation(() => Promise.resolve(null))
    })

    /**
     * AT-2367, the reported failure exactly. The user's own session shows the
     * Firestore write DID land (`statisticsModalDate` moved) and
     * `selectRandomSomedayTask` short-circuits on his account — so the only
     * unbounded step left in front of `appReloader.reload()` was
     * `deleteCache`'s `await registration.update()`, a network fetch of the
     * service worker script. On an installed iOS PWA resumed from background
     * that can hang indefinitely, and the popup — which only closed after the
     * reload call — stayed on screen forever.
     */
    it('reloads even when the service worker update check never answers', async () => {
        const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: { getRegistration: () => Promise.resolve({ update: () => new Promise(() => {}) }) },
        })
        jest.useFakeTimers()

        const refreshed = deleteCacheAndRefresh()

        for (let tick = 0; tick < 10; tick++) await Promise.resolve()
        jest.advanceTimersByTime(PRE_RELOAD_BUDGET_MS)
        await refreshed

        expect(reload).toHaveBeenCalledTimes(1)

        jest.useRealTimers()
        if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
        else delete navigator.serviceWorker
    })

    it('reloads even when the pre-reload work throws', async () => {
        const somedayTask = require('../../utils/backends/Tasks/randomSomedayTask')
        somedayTask.selectRandomSomedayTask.mockImplementation(() => {
            throw new Error('firestore unavailable')
        })
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

        await deleteCacheAndRefresh()

        consoleError.mockRestore()

        expect(reload).toHaveBeenCalledTimes(1)
        somedayTask.selectRandomSomedayTask.mockImplementation(() => Promise.resolve(null))
    })
})

describe('storeVersion / updateVersion', () => {
    it('reloads exactly once when a stale bundle is running, then stays put', async () => {
        // No refresh affordance was used: the browser served a cached v1 bundle
        // while the server is on v2.
        setStoredVersion(V1)

        await bootPage(V2)

        expect(reload).toHaveBeenCalledTimes(1)
        expect(readStoredVersion()).toEqual({ major: '1', minor: '5', patch: '0' })

        reload.mockClear()
        await bootPage(V2)

        expect(reload).not.toHaveBeenCalled()
    })

    it('adopts the server version as a baseline on a first load instead of reloading', async () => {
        await bootPage(V2)

        expect(reload).not.toHaveBeenCalled()
        expect(readStoredVersion()).toEqual({ major: '1', minor: '5', patch: '0' })
    })

    it('writes the marker as strings, which the native storage backend requires', async () => {
        setStoredVersion(V1)

        await bootPage(V2)

        AsyncStorage.setItem.mock.calls.forEach(([, value]) => expect(typeof value).toBe('string'))
    })

    it('never reloads on a malformed server version', async () => {
        setStoredVersion(V1)

        await bootPage({ major: undefined, minor: undefined, patch: undefined })

        expect(reload).not.toHaveBeenCalled()
        expect(readStoredVersion()).toEqual({ major: '1', minor: '4', patch: '0' })
    })

    it('does not reload when the server reports its version as strings', async () => {
        setStoredVersion(V1)

        await bootPage({ major: '1', minor: '4', patch: '0' })

        expect(reload).not.toHaveBeenCalled()
    })
})
