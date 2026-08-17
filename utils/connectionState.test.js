import { installConnectionStateListener, isBrowserOffline } from './connectionState'
import store from '../redux/store'
import { setConnectionState } from '../redux/actions'

const DEBOUNCE_MS = 500

function createFakeWindow({ onLine = true } = {}) {
    const listeners = {}
    return {
        navigator: { onLine },
        addEventListener: (type, fn) => {
            listeners[type] = listeners[type] || []
            listeners[type].push(fn)
        },
        removeEventListener: (type, fn) => {
            listeners[type] = (listeners[type] || []).filter(listener => listener !== fn)
        },
        emit: type => {
            ;(listeners[type] || []).forEach(fn => fn())
        },
        listenerCount: type => (listeners[type] || []).length,
    }
}

function createFakeStore(initialState = '') {
    let connectionState = initialState
    const dispatched = []
    return {
        dispatch: action => {
            dispatched.push(action)
            connectionState = action.connectionState
        },
        getConnectionState: () => connectionState,
        dispatched,
    }
}

describe('isBrowserOffline', () => {
    afterEach(() => {
        Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
    })

    it('reflects navigator.onLine synchronously', () => {
        expect(isBrowserOffline()).toBe(false)
        Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
        expect(isBrowserOffline()).toBe(true)
    })
})

describe('installConnectionStateListener', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('does nothing and returns a noop without a window', () => {
        const stop = installConnectionStateListener({ windowObject: undefined })
        expect(typeof stop).toBe('function')
        stop()
    })

    it('dispatches offline after the debounce when the browser goes offline', () => {
        const windowObject = createFakeWindow()
        const fakeStore = createFakeStore()
        installConnectionStateListener({
            windowObject,
            dispatch: fakeStore.dispatch,
            getConnectionState: fakeStore.getConnectionState,
        })

        windowObject.navigator.onLine = false
        windowObject.emit('offline')
        expect(fakeStore.dispatched).toHaveLength(0)

        jest.advanceTimersByTime(DEBOUNCE_MS)
        expect(fakeStore.getConnectionState()).toBe('offline')
    })

    it('never dispatches online on boot — only as a recovery from offline', () => {
        const windowObject = createFakeWindow()
        const fakeStore = createFakeStore()
        installConnectionStateListener({
            windowObject,
            dispatch: fakeStore.dispatch,
            getConnectionState: fakeStore.getConnectionState,
        })

        // A spurious online event while the state was never offline: no toast, no dispatch.
        windowObject.emit('online')
        jest.advanceTimersByTime(DEBOUNCE_MS)
        expect(fakeStore.dispatched).toHaveLength(0)

        // Real offline → online round trip dispatches both transitions.
        windowObject.navigator.onLine = false
        windowObject.emit('offline')
        jest.advanceTimersByTime(DEBOUNCE_MS)
        windowObject.navigator.onLine = true
        windowObject.emit('online')
        jest.advanceTimersByTime(DEBOUNCE_MS)
        expect(fakeStore.dispatched.map(action => action.connectionState)).toEqual(['offline', 'online'])
    })

    it('debounces a rapid offline/online flap into no state change', () => {
        const windowObject = createFakeWindow()
        const fakeStore = createFakeStore()
        installConnectionStateListener({
            windowObject,
            dispatch: fakeStore.dispatch,
            getConnectionState: fakeStore.getConnectionState,
        })

        windowObject.navigator.onLine = false
        windowObject.emit('offline')
        jest.advanceTimersByTime(DEBOUNCE_MS - 1)
        windowObject.navigator.onLine = true
        windowObject.emit('online')
        jest.advanceTimersByTime(DEBOUNCE_MS)
        expect(fakeStore.dispatched).toHaveLength(0)
    })

    it('picks up a page that loads while already offline', () => {
        const windowObject = createFakeWindow({ onLine: false })
        const fakeStore = createFakeStore()
        installConnectionStateListener({
            windowObject,
            dispatch: fakeStore.dispatch,
            getConnectionState: fakeStore.getConnectionState,
        })

        jest.advanceTimersByTime(DEBOUNCE_MS)
        expect(fakeStore.getConnectionState()).toBe('offline')
    })

    it('stops listening and cancels the pending debounce on uninstall', () => {
        const windowObject = createFakeWindow()
        const fakeStore = createFakeStore()
        const stop = installConnectionStateListener({
            windowObject,
            dispatch: fakeStore.dispatch,
            getConnectionState: fakeStore.getConnectionState,
        })

        windowObject.navigator.onLine = false
        windowObject.emit('offline')
        stop()
        jest.advanceTimersByTime(DEBOUNCE_MS)
        expect(fakeStore.dispatched).toHaveLength(0)
        expect(windowObject.listenerCount('online')).toBe(0)
        expect(windowObject.listenerCount('offline')).toBe(0)
    })

    it('wires the real store by default (action + reducer round trip)', () => {
        const windowObject = createFakeWindow()
        const stop = installConnectionStateListener({ windowObject })

        expect(store.getState().connectionState).toBe('')
        windowObject.navigator.onLine = false
        windowObject.emit('offline')
        jest.advanceTimersByTime(DEBOUNCE_MS)
        expect(store.getState().connectionState).toBe('offline')

        stop()
        store.dispatch(setConnectionState(''))
    })
})
