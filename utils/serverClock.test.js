import firebase from 'firebase/compat/app'

import { getClockOffsetMs, getServerNow, resetServerClockForTests, syncServerClock } from './serverClock'

let mockUid = 'user-1'

jest.mock('../redux/store', () => ({
    getState: () => ({ loggedUser: { uid: mockUid } }),
}))

const docRefs = {}

const makeDocRef = path => {
    const ref = {
        path,
        set: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({ data: () => ({ time: { toMillis: () => ref.serverMs } }) })),
        serverMs: 0,
    }
    docRefs[path] = ref
    return ref
}

jest.mock('firebase/compat/app', () => {
    const doc = jest.fn()
    return {
        __esModule: true,
        default: {
            firestore: Object.assign(() => ({ doc }), { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } }),
            __doc: doc,
        },
    }
})

const setBrowserOnline = online => {
    Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true })
}

describe('serverClock', () => {
    beforeEach(() => {
        resetServerClockForTests()
        mockUid = 'user-1'
        setBrowserOnline(true)
        Object.keys(docRefs).forEach(key => delete docRefs[key])
        firebase.__doc.mockReset()
        firebase.__doc.mockImplementation(path => docRefs[path] || makeDocRef(path))
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('reads the client clock until an offset is measured', () => {
        expect(getClockOffsetMs()).toBe(0)
        expect(Math.abs(getServerNow() - Date.now())).toBeLessThan(50)
    })

    it('measures the offset against a PER-USER document, never the global /info/currentTime', async () => {
        const ref = makeDocRef('users/user-1/private/clockSync')
        ref.serverMs = Date.now() + 120000

        await syncServerClock()

        expect(firebase.__doc).toHaveBeenCalledWith('users/user-1/private/clockSync')
        expect(firebase.__doc).not.toHaveBeenCalledWith(expect.stringContaining('info/currentTime'))
        expect(ref.set).toHaveBeenCalledWith({ time: 'SERVER_TIMESTAMP' }, { merge: true })
        // `source: 'server'` matters: the cached snapshot of a pending write
        // resolves serverTimestamp() locally and would measure the client
        // against itself.
        expect(ref.get).toHaveBeenCalledWith({ source: 'server' })
        expect(getClockOffsetMs()).toBeGreaterThan(100000)
        expect(getServerNow()).toBeGreaterThan(Date.now() + 100000)
    })

    it('never touches the network while offline', async () => {
        setBrowserOnline(false)
        const ref = makeDocRef('users/user-1/private/clockSync')

        await syncServerClock()

        expect(ref.set).not.toHaveBeenCalled()
        expect(Math.abs(getServerNow() - Date.now())).toBeLessThan(50)
    })

    it('does not re-measure on every call', async () => {
        const ref = makeDocRef('users/user-1/private/clockSync')
        ref.serverMs = Date.now()

        await syncServerClock()
        await syncServerClock()
        await syncServerClock()

        expect(ref.set).toHaveBeenCalledTimes(1)
    })

    it('coalesces concurrent measurements into one round trip', async () => {
        const ref = makeDocRef('users/user-1/private/clockSync')
        ref.serverMs = Date.now()

        await Promise.all([syncServerClock(), syncServerClock(), syncServerClock()])

        expect(ref.set).toHaveBeenCalledTimes(1)
    })

    it('keeps the client clock when the measurement fails', async () => {
        const ref = makeDocRef('users/user-1/private/clockSync')
        ref.set.mockRejectedValueOnce(new Error('permission denied'))

        await expect(syncServerClock()).resolves.toBe(false)
        expect(getClockOffsetMs()).toBe(0)
        expect(Math.abs(getServerNow() - Date.now())).toBeLessThan(50)
    })

    it('does nothing before a user is signed in', async () => {
        mockUid = undefined

        await expect(syncServerClock()).resolves.toBe(false)
        expect(firebase.__doc).not.toHaveBeenCalled()
    })
})
