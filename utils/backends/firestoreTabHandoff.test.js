import {
    FIRESTORE_TAB_PRESENCE_CHANNEL,
    HEARTBEAT_MS,
    RELEASE_AFTER_HIDDEN_MS,
    VISIBLE_PEER_TTL_MS,
    installFirestoreTabHandoff,
} from './firestoreTabHandoff'
import {
    isFirestoreNetworkReleasedToVisibleTab,
    setFirestoreNetworkReleasedToVisibleTab,
} from './firestoreNetworkRelease'

jest.mock('../performance/performanceLogger', () => ({ logPerformanceMeasurement: jest.fn() }))

const createChannel = () => {
    const listeners = new Set()
    return {
        name: null,
        posted: [],
        postMessage(message) {
            this.posted.push(message.type)
        },
        addEventListener: (type, listener) => listeners.add(listener),
        removeEventListener: (type, listener) => listeners.delete(listener),
        close: jest.fn(),
        emit: data => listeners.forEach(listener => listener({ data })),
        listenerCount: () => listeners.size,
    }
}

const setup = ({ visibilityState = 'visible', parked = false } = {}) => {
    const db = {
        disableNetwork: jest.fn(() => Promise.resolve()),
        enableNetwork: jest.fn(() => Promise.resolve()),
    }
    const documentObject = { visibilityState }
    const channel = createChannel()
    const state = { parked }
    let onVisible = () => {}
    let onHidden = () => {}
    const stop = installFirestoreTabHandoff(db, {
        isParked: () => state.parked,
        documentObject,
        createChannel: name => {
            channel.name = name
            return channel
        },
        subscribeVisible: callback => {
            onVisible = callback
            return () => {}
        },
        subscribeHidden: callback => {
            onHidden = callback
            return () => {}
        },
    })
    const hide = () => {
        documentObject.visibilityState = 'hidden'
        onHidden()
    }
    const show = () => {
        documentObject.visibilityState = 'visible'
        onVisible({ hiddenMs: null })
    }
    // appResume also reports `focus`/`pageshow`, which can arrive while the page is still hidden.
    const focusWhileHidden = () => onVisible({ hiddenMs: null })
    return { db, channel, state, stop, hide, show, focusWhileHidden }
}

describe('installFirestoreTabHandoff', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-10-29T09:00:00Z'))
    })

    afterEach(() => {
        jest.useRealTimers()
        setFirestoreNetworkReleasedToVisibleTab(false)
    })

    it('announces a visible tab on install and on every heartbeat', () => {
        const { channel, stop } = setup()
        expect(channel.name).toBe(FIRESTORE_TAB_PRESENCE_CHANNEL)
        expect(channel.posted).toEqual(['visible'])

        jest.advanceTimersByTime(HEARTBEAT_MS * 2)
        expect(channel.posted).toEqual(['visible', 'visible', 'visible'])
        stop()
    })

    it('hands the connection to a visible tab only after being hidden long enough', () => {
        const { db, channel, hide, stop } = setup()
        hide()
        channel.emit({ type: 'visible', tabId: 'other' })

        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS - 1000)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(false)

        jest.advanceTimersByTime(1000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(true)
        stop()
    })

    it('keeps the connection while no other tab is visible', () => {
        const { db, hide, stop } = setup()
        hide()
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS * 4)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(false)
        stop()
    })

    it('releases at once when a tab becomes visible after this one has been hidden a while', () => {
        const { db, channel, hide, stop } = setup()
        hide()
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS * 3)
        expect(db.disableNetwork).not.toHaveBeenCalled()

        channel.emit({ type: 'visible', tabId: 'other' })
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        stop()
    })

    it('takes the connection back and announces itself when it becomes visible again', () => {
        const { db, channel, hide, show, stop } = setup()
        hide()
        channel.emit({ type: 'visible', tabId: 'other' })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS)
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(true)

        channel.posted.length = 0
        show()
        expect(db.enableNetwork).toHaveBeenCalledTimes(1)
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(false)
        expect(channel.posted).toEqual(['visible'])
        stop()
    })

    it('takes the connection back when the last visible tab goes hidden or closes', () => {
        const { db, channel, hide, stop } = setup()
        hide()
        channel.emit({ type: 'visible', tabId: 'a' })
        channel.emit({ type: 'visible', tabId: 'b' })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)

        channel.emit({ type: 'hidden', tabId: 'a' })
        expect(db.enableNetwork).not.toHaveBeenCalled()

        channel.emit({ type: 'hidden', tabId: 'b' })
        expect(db.enableNetwork).toHaveBeenCalledTimes(1)
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(false)
        stop()
    })

    it('takes the connection back when the visible tab stops announcing itself', () => {
        const { db, channel, hide, stop } = setup()
        hide()
        channel.emit({ type: 'visible', tabId: 'crashed' })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)

        jest.advanceTimersByTime(VISIBLE_PEER_TTL_MS + HEARTBEAT_MS)
        expect(db.enableNetwork).toHaveBeenCalledTimes(1)
        stop()
    })

    it('tells a tab that just went hidden that it is still visible', () => {
        const { channel, stop } = setup()
        channel.posted.length = 0
        channel.emit({ type: 'hidden', tabId: 'other' })
        expect(channel.posted).toEqual(['visible'])
        stop()
    })

    it('ignores its own messages', () => {
        const { db, channel, hide, stop } = setup()
        hide()
        const ownMessages = []
        channel.postMessage = message => ownMessages.push(message)
        jest.advanceTimersByTime(HEARTBEAT_MS)
        ownMessages.forEach(message => channel.emit(message))
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        stop()
    })

    it('never releases while the network is parked for offline', () => {
        const { db, channel, hide, stop } = setup({ parked: true })
        hide()
        channel.emit({ type: 'visible', tabId: 'other' })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS * 2)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        stop()
    })

    it('does not override "Continue offline" when it becomes visible', () => {
        const { db, channel, state, hide, show, stop } = setup()
        hide()
        channel.emit({ type: 'visible', tabId: 'other' })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS)
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(true)

        state.parked = true
        show()
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(false)
        expect(db.enableNetwork).not.toHaveBeenCalled()
        stop()
    })

    it('ignores a focus report from a page that is still hidden', () => {
        const { db, channel, hide, focusWhileHidden, stop } = setup()
        hide()
        channel.emit({ type: 'visible', tabId: 'other' })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS)
        focusWhileHidden()
        expect(isFirestoreNetworkReleasedToVisibleTab()).toBe(true)
        expect(db.enableNetwork).not.toHaveBeenCalled()
        stop()
    })

    it('treats a tab installed in the background as hidden from the start', () => {
        const { db, channel, stop } = setup({ visibilityState: 'hidden' })
        expect(channel.posted).toEqual(['hidden'])
        channel.emit({ type: 'visible', tabId: 'other' })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        stop()
    })

    it('takes the connection back and closes the channel when uninstalled', () => {
        const { db, channel, hide, stop } = setup()
        hide()
        channel.emit({ type: 'visible', tabId: 'other' })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS)
        stop()
        expect(db.enableNetwork).toHaveBeenCalledTimes(1)
        expect(channel.close).toHaveBeenCalled()
        expect(channel.listenerCount()).toBe(0)

        jest.advanceTimersByTime(HEARTBEAT_MS * 4)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
    })

    it('does nothing without a BroadcastChannel', () => {
        const db = { disableNetwork: jest.fn(), enableNetwork: jest.fn() }
        const stop = installFirestoreTabHandoff(db, {
            documentObject: { visibilityState: 'hidden' },
            createChannel: () => null,
        })
        jest.advanceTimersByTime(RELEASE_AFTER_HIDDEN_MS * 4)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        stop()
    })
})
