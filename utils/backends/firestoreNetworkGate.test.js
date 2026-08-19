import { installFirestoreNetworkGate } from './firestoreNetworkGate'
import store from '../../redux/store'
import { setConnectionState } from '../../redux/actions'

const createDbMock = () => ({
    disableNetwork: jest.fn(() => Promise.resolve()),
    enableNetwork: jest.fn(() => Promise.resolve()),
})

describe('installFirestoreNetworkGate', () => {
    afterEach(() => {
        store.dispatch(setConnectionState(''))
    })

    it('parks the network on the offline transition and resumes on recovery', () => {
        const db = createDbMock()
        const stop = installFirestoreNetworkGate(db)

        store.dispatch(setConnectionState('offline'))
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        expect(db.enableNetwork).not.toHaveBeenCalled()

        store.dispatch(setConnectionState('online'))
        expect(db.enableNetwork).toHaveBeenCalledTimes(1)
        stop()
    })

    it('ignores unrelated store updates and repeated identical states', () => {
        const db = createDbMock()
        const stop = installFirestoreNetworkGate(db)

        store.dispatch({ type: 'Set show new day notification', show: true })
        store.dispatch({ type: 'Set show new day notification', show: false })
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(db.enableNetwork).not.toHaveBeenCalled()

        store.dispatch(setConnectionState('offline'))
        store.dispatch({ type: 'Set show new day notification', show: true })
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        stop()
    })

    it('does nothing after being uninstalled', () => {
        const db = createDbMock()
        const stop = installFirestoreNetworkGate(db)
        stop()

        store.dispatch(setConnectionState('offline'))
        expect(db.disableNetwork).not.toHaveBeenCalled()
    })

    it('tolerates a client without network controls', () => {
        expect(() => installFirestoreNetworkGate(undefined)()).not.toThrow()
    })
})
