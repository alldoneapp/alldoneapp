/** @jest-environment jsdom */

import {
    CONNECTION_HEALTH_LIVE,
    CONNECTION_HEALTH_OFFLINE,
    CONNECTION_HEALTH_RECONNECTING,
    CONNECTION_HEALTH_SLOW,
    CONNECTION_HEALTH_STALE,
    SLOW_CONNECTION_THRESHOLD_MS,
    STALE_RETRY_MAX_MS,
    continueOffline,
    evaluateConnectionHealth,
    getConnectionHealth,
    handleAppResume,
    installConnectionHealthMonitor,
    isManualOfflineMode,
    markServerContact,
    nextStaleRetryDelay,
    reconnectNow,
    resetConnectionHealthForTests,
    startConnectionLatencySample,
} from './connectionHealth'
import { resetFirestoreRestartLeaseForTests } from './backends/firestoreRestartLease'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

const createFakeWindow = () => {
    const listeners = {}
    return {
        addEventListener: (type, fn) => {
            listeners[type] = listeners[type] || []
            listeners[type].push(fn)
        },
        removeEventListener: (type, fn) => {
            listeners[type] = (listeners[type] || []).filter(listener => listener !== fn)
        },
        emit: type => (listeners[type] || []).forEach(fn => fn()),
        listenerCount: type => (listeners[type] || []).length,
    }
}

/**
 * `get` behaviours: 'ok' resolves, 'hang' never settles (the timeout path — the
 * realistic shape of a dead transport, which does NOT reject), 'denied' rejects
 * with permission-denied, 'unavailable' rejects.
 */
const createFakeDb = behaviours => {
    const remaining = [...behaviours]
    const calls = { get: 0, disableNetwork: 0, enableNetwork: 0 }
    return {
        calls,
        doc: () => ({
            get: () => {
                calls.get++
                const behaviour = remaining.length > 1 ? remaining.shift() : remaining[0]
                if (behaviour === 'ok') return Promise.resolve({ exists: true })
                if (behaviour === 'hang') return new Promise(() => {})
                if (behaviour === 'denied') return Promise.reject({ code: 'permission-denied' })
                return Promise.reject({ code: 'unavailable' })
            },
        }),
        disableNetwork: () => {
            calls.disableNetwork++
            return Promise.resolve()
        },
        enableNetwork: () => {
            calls.enableNetwork++
            return Promise.resolve()
        },
    }
}

const install = ({ db, offline = false, ...rest } = {}) => {
    const windowObject = createFakeWindow()
    const documentObject = { visibilityState: 'visible' }
    const dispatched = []
    const tracked = []
    const stop = installConnectionHealthMonitor({
        windowObject,
        documentObject,
        intervalMs: 1000000,
        getDb: () => db,
        isOffline: () => offline,
        probeTimeoutMs: 5,
        dispatchHealth: health => dispatched.push(health),
        trackEvent: (name, params) => tracked.push({ name, params }),
        ...rest,
    })
    return { windowObject, documentObject, dispatched, tracked, stop }
}

describe('connectionHealth', () => {
    beforeEach(() => {
        resetConnectionHealthForTests()
        resetFirestoreRestartLeaseForTests()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        resetConnectionHealthForTests()
        resetFirestoreRestartLeaseForTests()
        jest.useRealTimers()
        console.warn.mockRestore()
    })

    it('is live before anything has happened', () => {
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)
    })

    it('offers offline work when a real server operation stays slow despite other server traffic', () => {
        jest.useFakeTimers()
        let clock = 1000
        const { dispatched, tracked, stop } = install({
            db: createFakeDb(['ok']),
            now: () => clock,
            slowConnectionLingerMs: 30000,
        })

        const finish = startConnectionLatencySample('write_ack')
        clock += SLOW_CONNECTION_THRESHOLD_MS - 1
        jest.advanceTimersByTime(SLOW_CONNECTION_THRESHOLD_MS - 1)
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)

        clock += 1
        jest.advanceTimersByTime(1)

        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_SLOW)
        expect(dispatched).toContain(CONNECTION_HEALTH_SLOW)
        expect(tracked).toContainEqual({
            name: 'connection_slow_detected',
            params: { duration_ms: 10000, browser_online: true, source: 'write_ack' },
        })

        // Other snapshots prove reachability, but they do not make this delayed
        // interactive operation fast or hide the user's offline choice.
        markServerContact('snapshot')
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_SLOW)

        finish()
        clock += 29999
        jest.advanceTimersByTime(29999)
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_SLOW)

        clock += 1
        jest.advanceTimersByTime(1)
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)

        stop()
        jest.useRealTimers()
    })

    it('does nothing and returns a noop without a window', () => {
        const stop = installConnectionHealthMonitor({ windowObject: undefined })
        expect(typeof stop).toBe('function')
        stop()
    })

    it('returns to live the moment a server snapshot arrives, without a probe', async () => {
        const db = createFakeDb(['unavailable'])
        const { dispatched, stop } = install({ db })

        await evaluateConnectionHealth({ trigger: 'test' })
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_STALE)

        // The recovery path is NOT debounced: a server snapshot is proof.
        markServerContact('snapshot')
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)
        expect(dispatched[dispatched.length - 1]).toBe(CONNECTION_HEALTH_LIVE)
        stop()
    })

    it('restarts the transport exactly once and re-probes before demoting to stale', async () => {
        const db = createFakeDb(['hang'])
        const { stop } = install({ db })

        await evaluateConnectionHealth({ trigger: 'test' })

        expect(db.calls.get).toBe(2) // probe, restart, re-probe
        expect(db.calls.disableNetwork).toBe(1)
        expect(db.calls.enableNetwork).toBe(1)
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_STALE)
        stop()
    })

    it('passes through reconnecting on the way to stale', async () => {
        const db = createFakeDb(['unavailable'])
        const { dispatched, stop } = install({ db })

        await evaluateConnectionHealth({ trigger: 'test' })

        expect(dispatched).toEqual([CONNECTION_HEALTH_RECONNECTING, CONNECTION_HEALTH_STALE])
        stop()
    })

    it('recovers to live when the probe succeeds after the restart', async () => {
        const db = createFakeDb(['unavailable', 'ok'])
        const { stop } = install({ db })

        await evaluateConnectionHealth({ trigger: 'test' })

        expect(db.calls.disableNetwork).toBe(1)
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)
        stop()
    })

    it('never reports stale for permission-denied — the server answered, so the transport works', async () => {
        const db = createFakeDb(['denied'])
        const { stop } = install({ db })

        await evaluateConnectionHealth({ trigger: 'test' })

        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)
        expect(db.calls.disableNetwork).toBe(0)
        stop()
    })

    it('never reports stale when there is no database handle', async () => {
        const { stop } = install({ db: null })

        await evaluateConnectionHealth({ trigger: 'test' })

        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)
        stop()
    })

    it('reports offline without probing when the browser is offline', async () => {
        const db = createFakeDb(['ok'])
        const { stop } = install({ db, offline: true })

        await evaluateConnectionHealth({ trigger: 'test' })

        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_OFFLINE)
        expect(db.calls.get).toBe(0)
        stop()
    })

    it('parks the transport when the user chooses offline and ignores late server contact', async () => {
        const db = createFakeDb(['ok'])
        const { tracked, stop } = install({ db })

        await continueOffline()

        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_OFFLINE)
        expect(isManualOfflineMode()).toBe(true)
        expect(db.calls.disableNetwork).toBe(1)
        expect(tracked.some(event => event.name === 'connection_manual_offline')).toBe(true)

        markServerContact('late_snapshot')
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_OFFLINE)

        await evaluateConnectionHealth({ trigger: 'staleness' })
        expect(db.calls.get).toBe(0)
        stop()
    })

    it('lets the user choose offline during the second probe without a late stale override', async () => {
        const db = createFakeDb(['unavailable', 'hang'])
        const { stop } = install({ db })

        const evaluating = evaluateConnectionHealth({ trigger: 'test' })
        await flush()
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_RECONNECTING)

        await continueOffline()
        await evaluating

        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_OFFLINE)
        expect(isManualOfflineMode()).toBe(true)
        stop()
    })

    it('coalesces concurrent evaluations into one probe cycle', async () => {
        const db = createFakeDb(['ok'])
        const { stop } = install({ db })

        await Promise.all([
            evaluateConnectionHealth({ trigger: 'a' }),
            evaluateConnectionHealth({ trigger: 'b' }),
            evaluateConnectionHealth({ trigger: 'c' }),
        ])

        expect(db.calls.get).toBe(1)
        stop()
    })

    it('emits connection_stale_detected with the browser-online flag — the core metric', async () => {
        const db = createFakeDb(['unavailable'])
        const { tracked, stop } = install({ db })

        await evaluateConnectionHealth({ trigger: 'staleness' })

        const staleEvent = tracked.find(event => event.name === 'connection_stale_detected')
        expect(staleEvent).toBeTruthy()
        expect(staleEvent.params.browser_online).toBe(true)
        stop()
    })

    it('caps the stale retry backoff', () => {
        expect(nextStaleRetryDelay(5000)).toBe(10000)
        expect(nextStaleRetryDelay(40000)).toBe(STALE_RETRY_MAX_MS)
        expect(nextStaleRetryDelay(STALE_RETRY_MAX_MS)).toBe(STALE_RETRY_MAX_MS)
    })

    it('goes offline on the browser offline event and re-probes on the online event', async () => {
        const db = createFakeDb(['ok'])
        let offline = false
        const { windowObject, stop } = install({ db, isOffline: () => offline })

        offline = true
        windowObject.emit('offline')
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_OFFLINE)

        // The browser's `online` event is optimistic (captive portals fire it), so
        // recovery must still be proven by a probe.
        offline = false
        windowObject.emit('online')
        await flush()
        expect(db.calls.get).toBe(1)
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)
        stop()
    })

    it('does not cycle Firestore again while the browser-online recovery is already rebuilding streams', async () => {
        const db = createFakeDb(['unavailable'])
        const { stop } = install({ db })

        await evaluateConnectionHealth({ trigger: 'browser_online' })

        expect(db.calls.get).toBe(2)
        expect(db.calls.disableNetwork).toBe(0)
        expect(db.calls.enableNetwork).toBe(0)
        expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_STALE)
        stop()
    })

    it('removes its listeners on uninstall', () => {
        const { windowObject, stop } = install({ db: createFakeDb(['ok']) })
        expect(windowObject.listenerCount('offline')).toBe(1)
        stop()
        expect(windowObject.listenerCount('offline')).toBe(0)
    })

    describe('the staleness monitor', () => {
        it('probes only after the silence threshold, and never straight to stale', async () => {
            const db = createFakeDb(['ok'])
            let clock = 1000
            const { stop } = install({
                db,
                intervalMs: 10,
                staleAfterMs: 5000,
                now: () => clock,
            })

            await new Promise(resolve => setTimeout(resolve, 30))
            expect(db.calls.get).toBe(0) // silent, but not long enough to be suspect

            clock += 6000
            await new Promise(resolve => setTimeout(resolve, 30))
            expect(db.calls.get).toBeGreaterThan(0)
            expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_LIVE)
            stop()
        })

        it('does not keep retrying into a hidden tab once stale, but does not give up either', async () => {
            const db = createFakeDb(['unavailable'])
            const { documentObject, stop } = install({ db, staleRetryBaseMs: 5 })

            await evaluateConnectionHealth({ trigger: 'test' })
            expect(getConnectionHealth()).toBe(CONNECTION_HEALTH_STALE)
            const probesWhenStale = db.calls.get

            documentObject.visibilityState = 'hidden'
            await new Promise(resolve => setTimeout(resolve, 40))
            expect(db.calls.get).toBe(probesWhenStale)

            // Still armed: becoming visible again must resume the retries rather
            // than leave the session stuck in stale forever.
            documentObject.visibilityState = 'visible'
            await new Promise(resolve => setTimeout(resolve, 60))
            expect(db.calls.get).toBeGreaterThan(probesWhenStale)
            stop()
        })

        it('stands down entirely while the tab is hidden', async () => {
            const db = createFakeDb(['ok'])
            let clock = 1000
            const { documentObject, stop } = install({
                db,
                intervalMs: 10,
                staleAfterMs: 5000,
                now: () => clock,
            })
            documentObject.visibilityState = 'hidden'

            clock += 60000
            await new Promise(resolve => setTimeout(resolve, 30))

            expect(db.calls.get).toBe(0)
            stop()
        })
    })

    describe('handleAppResume', () => {
        it('does nothing below the probe threshold — a short resume must cost nothing', async () => {
            const db = createFakeDb(['ok'])
            const { stop } = install({ db })

            await handleAppResume({ hiddenMs: 5000, probeAfterMs: 30000 })

            expect(db.calls.get).toBe(0)
            stop()
        })

        it('probes above the threshold', async () => {
            const db = createFakeDb(['ok'])
            const { stop } = install({ db })

            await handleAppResume({ hiddenMs: 120000, probeAfterMs: 30000 })

            expect(db.calls.get).toBe(1)
            stop()
        })
    })

    describe('reconnectNow', () => {
        it('restarts the transport and reports the outcome', async () => {
            const db = createFakeDb(['ok'])
            const { tracked, stop } = install({ db })

            const outcome = await reconnectNow()

            expect(db.calls.disableNetwork).toBe(1)
            expect(outcome).toBe(CONNECTION_HEALTH_LIVE)
            expect(tracked.some(event => event.name === 'connection_manual_reconnect')).toBe(true)
            stop()
        })

        it('leaves the user in stale when the connection is genuinely dead', async () => {
            const db = createFakeDb(['unavailable'])
            const { stop } = install({ db })

            const outcome = await reconnectNow()

            expect(outcome).toBe(CONNECTION_HEALTH_STALE)
            stop()
        })

        it('exits manual offline before restarting and probing', async () => {
            const db = createFakeDb(['ok'])
            const { stop } = install({ db })
            await continueOffline()

            const outcome = await reconnectNow()

            expect(outcome).toBe(CONNECTION_HEALTH_LIVE)
            expect(isManualOfflineMode()).toBe(false)
            expect(db.calls.get).toBe(1)
            stop()
        })
    })
})
