/**
 * AT-2340. The gate's DEFAULT offline signal (the one the real watchers use — the
 * unit tests in cachedSnapshotGate.test.js all inject their own) has to work
 * during cold boot, which is the one moment the redux slice cannot help:
 * `installConnectionStateListener` is installed from AppNavigator's AppContainer,
 * which AppContent does not mount while `loggedIn === null`, and it debounces a
 * further 500ms on top. The list watchers start inside that window, so a slice-only
 * check left an offline boot staring at an empty list for the full 4s grace.
 */
let mockConnectionState = ''
let mockNavigatorOnLine = true

jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ connectionState: mockConnectionState }) },
}))
jest.mock('../connectionState', () => ({ isBrowserOffline: () => mockNavigatorOnLine === false }))

const { createCachedSnapshotGate } = require('./cachedSnapshotGate')

const cachedSnapshot = () => ({
    docs: [],
    size: 0,
    empty: true,
    forEach: () => {},
    docChanges: () => [],
    metadata: { fromCache: true, hasPendingWrites: false },
})

describe('cachedSnapshotGate default offline signal', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockConnectionState = ''
        mockNavigatorOnLine = true
    })
    afterEach(() => jest.useRealTimers())

    const buffersFirstCachedSnapshot = () => {
        const gate = createCachedSnapshotGate(() => () => {})
        return gate.shouldBuffer(cachedSnapshot())
    }

    it('delivers cached data during a cold offline boot, before the slice is fed', () => {
        // Exactly the boot state: nothing has ever set connectionState, but the
        // browser knows perfectly well that it is offline.
        mockConnectionState = ''
        mockNavigatorOnLine = false

        expect(buffersFirstCachedSnapshot()).toBe(false)
    })

    it('still buffers cached data when genuinely online (unchanged behavior)', () => {
        mockConnectionState = ''
        mockNavigatorOnLine = true

        expect(buffersFirstCachedSnapshot()).toBe(true)
    })

    it('honors the redux slice when it disagrees with an optimistic navigator', () => {
        // Captive portals report onLine === true; the slice stays authoritative.
        mockConnectionState = 'offline'
        mockNavigatorOnLine = true

        expect(buffersFirstCachedSnapshot()).toBe(false)
    })
})
