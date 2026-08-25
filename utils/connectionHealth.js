/**
 * Connection health — is the app actually talking to the server right now? (PT-4660)
 *
 * `connectionState` (utils/connectionState.js) answers a different, weaker question:
 * what the BROWSER thinks. That signal is structurally blind to the failure this
 * module exists for — a Firestore transport that died while `navigator.onLine`
 * still reports `true`. It is the normal outcome of a laptop lid closed for an
 * hour, a phone that suspended the tab, a captive portal, or a VPN that came up
 * while the tab was hidden: the browser sees a working network, the SDK's Listen
 * streams are gone, and the app happily renders cache-age data as if it were live.
 * Nothing in the app could previously notice, so the user's only tell was noticing
 * that nothing had updated in a while.
 *
 * The state machine, deliberately biased towards `live`:
 *
 *   live          the server was heard from recently — the normal state, renders nothing
 *   slow          an interactive server read or write has waited at least ten seconds —
 *                 work can continue online or switch offline without a transport restart
 *   reconnecting  a probe failed once; Firestore is reconnecting and is being re-probed
 *   stale         two probes failed while the browser claims to be online — the app is
 *                 showing data of unknown age. THIS is the state the app could not see before.
 *   offline       the browser itself reports offline — already covered by the offline toast
 *
 * Two rules govern every transition, and they are the reason this can ship without
 * a measurement phase first:
 *
 * 1. **Every uncertain path ends in `live`.** No database handle, no window, a
 *    `permission-denied` (an auth problem, not a transport problem), an
 *    unrecognised error — all resolve to `live`. A false "your data is stale"
 *    warning is a defect of exactly the same severity as a missed one, because it
 *    trains the user to ignore the indicator.
 * 2. **Suspicion is never enough; only a failed probe demotes.** Silence from the
 *    server is not evidence — Firestore snapshots are edge-triggered, so a healthy
 *    idle app is silent by design. Staleness only ever schedules a probe.
 *
 * Cost: the probe is a single `info/version` document read. A fully idle visible
 * tab therefore costs one read per STALE_AFTER_MS (a successful probe counts as
 * server contact and restarts the clock), and a hidden tab costs nothing — the
 * monitor stands down entirely, with `appResume` re-arming it.
 */
import { isBrowserOffline } from './connectionState'
import { runExclusiveFirestoreRestart } from './backends/firestoreRestartLease'
import { requestFirestoreClientReload } from './firestoreFatalRecovery'

export const CONNECTION_HEALTH_LIVE = 'live'
export const CONNECTION_HEALTH_SLOW = 'slow'
export const CONNECTION_HEALTH_RECONNECTING = 'reconnecting'
export const CONNECTION_HEALTH_STALE = 'stale'
export const CONNECTION_HEALTH_OFFLINE = 'offline'

/**
 * No server contact for this long makes the connection *suspect* — never stale by
 * itself. Also the steady-state probe interval for an idle visible tab, since a
 * successful probe marks contact. Deliberately generous: the resume path (the
 * scenario this feature is named after) detects immediately and does not wait for it.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000

/** How often the monitor asks "has it been quiet too long?". Cheap — no I/O unless it has. */
export const STALENESS_CHECK_INTERVAL_MS = 60 * 1000

/**
 * A probe that has not answered in this long counts as unreachable. Sized above a
 * bad-but-working mobile round trip so a slow connection is not called dead: the
 * worst case for a definitive verdict is probe + restart + probe ≈ 11.5s.
 */
export const PROBE_TIMEOUT_MS = 5000

/**
 * `disableNetwork()` / `enableNetwork()` are local AsyncQueue operations and
 * normally settle almost immediately. If they do not settle inside this
 * generous budget, the current Firestore client cannot repair itself; waiting
 * longer only leaves every reconnect UI spinning on the same poisoned queue.
 */
export const FIRESTORE_RESTART_TIMEOUT_MS = 5000

/**
 * Offer offline work when a real page read or write acknowledgement takes this long.
 * Ten seconds, not five: a read that is merely sluggish recovers on its own well
 * inside that window, so the shorter threshold spent the indicator on connections
 * that were about to answer anyway — and an indicator that cries wolf is one the
 * user learns to ignore, which is the same defect as never showing it at all.
 */
export const SLOW_CONNECTION_THRESHOLD_MS = 10000

/** Keep the choice visible briefly after the delayed operation eventually completes. */
export const SLOW_CONNECTION_LINGER_MS = 30 * 1000

/** Backoff between re-probes while stale, doubling from the first value up to the cap. */
export const STALE_RETRY_BASE_MS = 5000
export const STALE_RETRY_MAX_MS = 60 * 1000

const HEALTH_STATES = new Set([
    CONNECTION_HEALTH_LIVE,
    CONNECTION_HEALTH_SLOW,
    CONNECTION_HEALTH_RECONNECTING,
    CONNECTION_HEALTH_STALE,
    CONNECTION_HEALTH_OFFLINE,
])

let health = CONNECTION_HEALTH_LIVE
let manualOffline = false
let lastServerContactAt = null
let lastChangeAt = null
let probeInFlight = null
let probeCycleId = 0
let retryTimer
let retryDelayMs = STALE_RETRY_BASE_MS
let latencyGeneration = 0
let activeSlowSamples = 0
let slowRecoveryTimer
const healthListeners = new Set()

// Injected once by installConnectionHealthMonitor so the module stays importable
// (and unit-testable) without pulling in the redux store, the Firebase client or
// the analytics bundle — the lazy-require pattern used by linkedEmailActions.
let deps = {}

const now = () => (deps.now ? deps.now() : Date.now())

const dispatchHealth = nextHealth => {
    if (deps.dispatchHealth) {
        deps.dispatchHealth(nextHealth)
        return
    }
    try {
        // eslint-disable-next-line global-require
        const store = require('../redux/store').default
        // eslint-disable-next-line global-require
        const { setConnectionHealth } = require('../redux/actions')
        store.dispatch(setConnectionHealth(nextHealth))
    } catch (error) {
        // Redux not available (early boot, tests) — the state machine still runs;
        // only the display is missing.
    }
}

const track = (name, params) => {
    if (deps.trackEvent) {
        deps.trackEvent(name, params)
        return
    }
    try {
        // eslint-disable-next-line global-require
        require('./analytics/analytics').trackEvent(name, params)
    } catch (error) {
        // Analytics is best-effort and consent-gated; never let it affect behaviour.
    }
}

const getDbSafe = () => {
    if (deps.getDb) return deps.getDb()
    try {
        // eslint-disable-next-line global-require
        return require('./backends/firestore').getDb()
    } catch (error) {
        return null
    }
}

const browserIsOffline = () => (deps.isOffline ? deps.isOffline() : isBrowserOffline())

// Set by installConnectionHealthMonitor; the retry path needs it too, not just the
// monitor's tick, so it cannot live in that closure.
let documentRef = null
const documentIsHidden = () => !!documentRef && documentRef.visibilityState === 'hidden'

export const getConnectionHealth = () => health

/** The user explicitly parked the transport to keep working from the local cache. */
export const isManualOfflineMode = () => manualOffline

export const getMillisSinceServerContact = () => (lastServerContactAt === null ? null : now() - lastServerContactAt)

const clearRetryTimer = () => {
    if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
    }
}

const clearSlowRecoveryTimer = () => {
    if (slowRecoveryTimer !== undefined) {
        clearTimeout(slowRecoveryTimer)
        slowRecoveryTimer = undefined
    }
}

const invalidateLatencySamples = () => {
    latencyGeneration++
    activeSlowSamples = 0
    clearSlowRecoveryTimer()
}

const setHealth = (nextHealth, trigger) => {
    if (!HEALTH_STATES.has(nextHealth) || nextHealth === health) return
    const previous = health
    const changedAt = now()
    const durationMs = lastChangeAt === null ? 0 : changedAt - lastChangeAt
    health = nextHealth
    lastChangeAt = changedAt

    if (
        nextHealth === CONNECTION_HEALTH_RECONNECTING ||
        nextHealth === CONNECTION_HEALTH_STALE ||
        nextHealth === CONNECTION_HEALTH_OFFLINE
    ) {
        invalidateLatencySamples()
    }

    if (nextHealth === CONNECTION_HEALTH_LIVE) {
        retryDelayMs = STALE_RETRY_BASE_MS
        clearRetryTimer()
    }

    // Consistent with the [BootIntegrity] / [Firestore] prefixes: a user report
    // without DevTools access stays diagnosable (the lesson from AT-2357).
    if (nextHealth !== CONNECTION_HEALTH_LIVE) {
        console.warn(`[ConnectionHealth] ${previous} → ${nextHealth} (${trigger})`)
    }

    track('connection_health_change', {
        state_from: previous,
        state_to: nextHealth,
        trigger,
        duration_ms: durationMs,
    })
    dispatchHealth(nextHealth)
    healthListeners.forEach(listener => listener(nextHealth))
}

/** Observe health changes without coupling low-level write helpers to Redux. */
export const subscribeConnectionHealth = listener => {
    if (typeof listener !== 'function') return () => {}
    healthListeners.add(listener)
    return () => healthListeners.delete(listener)
}

const scheduleSlowRecovery = generation => {
    clearSlowRecoveryTimer()
    const lingerMs = deps.slowConnectionLingerMs || SLOW_CONNECTION_LINGER_MS
    slowRecoveryTimer = setTimeout(() => {
        slowRecoveryTimer = undefined
        if (
            generation !== latencyGeneration ||
            activeSlowSamples > 0 ||
            manualOffline ||
            health !== CONNECTION_HEALTH_SLOW
        ) {
            return
        }
        invalidateLatencySamples()
        setHealth(CONNECTION_HEALTH_LIVE, 'slow_connection_recovered')
    }, lingerMs)
}

/**
 * Times a real server-dependent operation. Unlike the reachability probe, this
 * does not restart or park Firestore: it only exposes the user's offline choice
 * when an otherwise working connection makes a page read or write feel stuck.
 */
export const startConnectionLatencySample = (source = 'server_operation') => {
    if (
        manualOffline ||
        browserIsOffline() ||
        (health !== CONNECTION_HEALTH_LIVE && health !== CONNECTION_HEALTH_SLOW)
    ) {
        return () => {}
    }

    const generation = latencyGeneration
    const startedAt = now()
    const thresholdMs = deps.slowConnectionThresholdMs || SLOW_CONNECTION_THRESHOLD_MS
    let finished = false
    let reportedSlow = false

    const timer = setTimeout(() => {
        if (
            finished ||
            generation !== latencyGeneration ||
            manualOffline ||
            browserIsOffline() ||
            (health !== CONNECTION_HEALTH_LIVE && health !== CONNECTION_HEALTH_SLOW)
        ) {
            return
        }

        reportedSlow = true
        activeSlowSamples++
        clearSlowRecoveryTimer()
        const wasAlreadySlow = health === CONNECTION_HEALTH_SLOW
        setHealth(CONNECTION_HEALTH_SLOW, 'slow_server_operation')
        if (!wasAlreadySlow) {
            track('connection_slow_detected', {
                duration_ms: now() - startedAt,
                browser_online: !browserIsOffline(),
                source,
            })
        }
    }, thresholdMs)

    return () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (!reportedSlow || generation !== latencyGeneration) return
        activeSlowSamples = Math.max(0, activeSlowSamples - 1)
        if (activeSlowSamples === 0 && health === CONNECTION_HEALTH_SLOW) scheduleSlowRecovery(generation)
    }
}

/**
 * A server snapshot arrived — the single positive proof the transport is alive.
 * Called from the cached-snapshot gate, which already distinguishes server from
 * cache, and from a successful probe.
 */
export const markServerContact = (trigger = 'snapshot') => {
    lastServerContactAt = now()
    // A late server snapshot from the connection we just parked must not undo an
    // explicit user choice. Reconnect now is the only exit from manual offline.
    if (manualOffline) return
    // A different snapshot arriving does not make the delayed interactive
    // operation fast. Its own completion owns recovery from the `slow` state.
    if (health === CONNECTION_HEALTH_SLOW) return
    if (health !== CONNECTION_HEALTH_LIVE) setHealth(CONNECTION_HEALTH_LIVE, trigger)
}

const probeServer = async () => {
    const db = getDbSafe()
    // No handle means we cannot form an opinion — and an opinion we cannot form
    // must never read as "your data is stale".
    if (!db || typeof db.doc !== 'function') return 'unknown'

    let timer
    try {
        const outcome = await Promise.race([
            db
                .doc('info/version')
                .get({ source: 'server' })
                .then(() => 'ok'),
            new Promise(resolve => {
                timer = setTimeout(() => resolve('timeout'), deps.probeTimeoutMs || PROBE_TIMEOUT_MS)
            }),
        ])
        return outcome === 'timeout' ? 'unreachable' : 'ok'
    } catch (error) {
        const code = error && error.code
        // An auth failure proves the transport WORKS — the server answered, it just
        // said no. Treating it as staleness would show a connection warning for a
        // permissions problem and send the user chasing their Wi-Fi.
        if (code === 'permission-denied' || code === 'unauthenticated') return 'denied'
        return 'unreachable'
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

/**
 * Check the backend without touching the possibly poisoned Firestore
 * AsyncQueue. A successful REST document response (including "not found")
 * proves that replacing this one client is useful; a network failure means a
 * reload would only discard the current page while the device is still unable
 * to reach Firestore.
 */
const probeServerOutsideClient = async () => {
    let timer
    try {
        const directProbe = deps.probeServerDirectly
            ? deps.probeServerDirectly()
            : // eslint-disable-next-line global-require
              require('./backends/firestoreDirectRead').readDocumentDirectlyFromServer('info/version')
        const outcome = await Promise.race([
            Promise.resolve(directProbe).then(
                () => 'reachable',
                error => {
                    const code = String((error && error.code) || '').toLowerCase()
                    // The REST service answered; a fresh client may still need to
                    // refresh auth, but this is not an offline/captive-portal reload.
                    if (code.includes('permission') || code.includes('unauthenticated')) return 'reachable'
                    return 'unreachable'
                }
            ),
            new Promise(resolve => {
                timer = setTimeout(() => resolve('unreachable'), deps.probeTimeoutMs || PROBE_TIMEOUT_MS)
            }),
        ])
        return outcome === 'reachable'
    } catch (error) {
        return false
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

const restartTransport = async trigger => {
    const restart = runExclusiveFirestoreRestart(async () => {
        const db = getDbSafe()
        if (!db || typeof db.disableNetwork !== 'function') return
        await db.disableNetwork()
        await db.enableNetwork()
    })

    let timeoutTimer
    const timeoutMs = deps.firestoreRestartTimeoutMs || FIRESTORE_RESTART_TIMEOUT_MS
    const outcome = await Promise.race([
        restart.then(succeeded => (succeeded ? 'ok' : 'failed')),
        new Promise(resolve => {
            timeoutTimer = setTimeout(() => resolve('timeout'), timeoutMs)
        }),
    ])
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)

    if (outcome === 'ok') return { ok: true, reason: 'ok', reloadRequested: false }

    const reason = outcome === 'timeout' ? 'restart_timeout' : 'restart_failed'
    console.warn(`[ConnectionHealth] Firestore transport ${outcome}; replacing the client (${trigger}).`)
    let reloadRequested = false
    if (!browserIsOffline()) {
        const serverReachable = await probeServerOutsideClient()
        if (serverReachable) {
            const requestReload = deps.requestClientReload || requestFirestoreClientReload
            try {
                reloadRequested = requestReload(reason)
            } catch (error) {
                console.warn('[ConnectionHealth] Could not request a fresh Firestore client:', error)
            }
        } else {
            console.warn('[ConnectionHealth] Skipping client replacement because Firestore is not reachable.')
        }
    }
    return { ok: false, reason, reloadRequested }
}

const finishFailedRestart = (trigger, restart) => {
    if (browserIsOffline()) {
        setHealth(CONNECTION_HEALTH_OFFLINE, `${trigger}_${restart.reason}`)
        return health
    }

    track('connection_stale_detected', {
        duration_ms: getMillisSinceServerContact() || 0,
        browser_online: true,
        trigger: `${trigger}_${restart.reason}`,
    })
    setHealth(CONNECTION_HEALTH_STALE, `${trigger}_${restart.reason}`)
    scheduleStaleRetry()
    return health
}

/** Exported for the cap test — a backoff that never stops growing is a battery bug. */
export const nextStaleRetryDelay = currentMs => Math.min(currentMs * 2, STALE_RETRY_MAX_MS)

const scheduleStaleRetry = () => {
    clearRetryTimer()
    const delay = retryDelayMs
    retryDelayMs = nextStaleRetryDelay(retryDelayMs)
    retryTimer = setTimeout(() => {
        retryTimer = undefined
        // A hidden tab can sit in `stale` for hours. Retrying into a screen nobody
        // is looking at spends battery to refresh a view that will be re-probed by
        // appResume the moment it is looked at again — so wait, without giving up.
        if (documentIsHidden()) {
            scheduleStaleRetry()
            return
        }
        evaluateConnectionHealth({ trigger: 'stale_retry' }).catch(() => {})
    }, delay)
}

const runProbeCycle = async (trigger, cycleId) => {
    if (manualOffline) return health
    if (browserIsOffline()) {
        setHealth(CONNECTION_HEALTH_OFFLINE, trigger)
        return health
    }

    const first = await probeServer()
    if (cycleId !== probeCycleId || manualOffline) return health
    if (first === 'ok') {
        markServerContact(trigger)
        return health
    }
    if (first === 'denied' || first === 'unknown') {
        // Uncertain, or certainly not a transport problem → live.
        setHealth(CONNECTION_HEALTH_LIVE, trigger)
        return health
    }

    // The browser can drop out mid-probe; that is the offline path, not staleness.
    if (browserIsOffline()) {
        setHealth(CONNECTION_HEALTH_OFFLINE, trigger)
        return health
    }

    // One failure is not a verdict. On a browser `online` event the SDK and the
    // offline network gate are already recreating the Listen stream; cycling it
    // again here can overlap that recovery and trigger Firestore's fatal ca9
    // pending-response race. Give that existing recovery a second probe instead.
    // Other triggers still rebuild the transport through the shared lease.
    setHealth(CONNECTION_HEALTH_RECONNECTING, trigger)
    if (trigger !== 'browser_online') {
        const restart = await restartTransport(trigger)
        if (!restart.ok) return finishFailedRestart(trigger, restart)
    }

    // The offline action is offered as soon as reconnecting appears. The user can
    // therefore choose it while either recovery path is in flight; do not start
    // a second probe after that explicit choice.
    if (cycleId !== probeCycleId || manualOffline) return health

    const second = await probeServer()
    if (cycleId !== probeCycleId || manualOffline) return health
    if (second === 'ok') {
        markServerContact(trigger)
        return health
    }
    if (second === 'denied' || second === 'unknown') {
        setHealth(CONNECTION_HEALTH_LIVE, trigger)
        return health
    }
    if (browserIsOffline()) {
        setHealth(CONNECTION_HEALTH_OFFLINE, trigger)
        return health
    }

    track('connection_stale_detected', {
        duration_ms: getMillisSinceServerContact() || 0,
        browser_online: !browserIsOffline(),
        trigger,
    })
    setHealth(CONNECTION_HEALTH_STALE, trigger)
    scheduleStaleRetry()
    return health
}

/**
 * Runs one probe cycle, coalescing concurrent callers: a burst of suspicion
 * (resume + staleness tick + the manual button) probes once, not three times.
 */
export const evaluateConnectionHealth = ({ trigger = 'manual' } = {}) => {
    if (manualOffline) return Promise.resolve(health)
    if (probeInFlight) return probeInFlight
    clearRetryTimer()
    const cycleId = ++probeCycleId
    const cyclePromise = runProbeCycle(trigger, cycleId).catch(error => {
        console.warn('[ConnectionHealth] Probe cycle failed:', error)
        return health
    })
    const trackedPromise = cyclePromise.finally(() => {
        if (probeInFlight === trackedPromise) probeInFlight = null
    })
    probeInFlight = trackedPromise
    return probeInFlight
}

/**
 * Keep working from IndexedDB and queue writes until the user explicitly retries
 * online. The transport may currently be inside the restart between the two
 * five-second probes, so join that lease first and make our final operation the
 * disable — otherwise the restart's enable could silently undo this choice.
 */
export const continueOffline = async () => {
    const stateBefore = health
    manualOffline = true
    probeCycleId++
    probeInFlight = null
    clearRetryTimer()
    setHealth(CONNECTION_HEALTH_OFFLINE, 'manual_offline')

    // A no-op joins an existing restart, or briefly owns the lease when idle.
    await runExclusiveFirestoreRestart(async () => {})
    if (manualOffline) {
        const db = getDbSafe()
        if (db && typeof db.disableNetwork === 'function') {
            try {
                await db.disableNetwork()
            } catch (error) {
                console.warn('[ConnectionHealth] Failed to enter manual offline mode:', error)
            }
        }
    }

    track('connection_manual_offline', { state_from: stateBefore, outcome: health })
    return health
}

/** The "Reconnect now" button. Always probes, whatever the current state. */
export const reconnectNow = async () => {
    const stateBefore = health
    manualOffline = false
    probeCycleId++
    probeInFlight = null

    if (browserIsOffline()) {
        setHealth(CONNECTION_HEALTH_OFFLINE, 'manual_reconnect')
        track('connection_manual_reconnect', { state_from: stateBefore, outcome: CONNECTION_HEALTH_OFFLINE })
        return health
    }

    setHealth(CONNECTION_HEALTH_RECONNECTING, 'manual_reconnect')
    // A manual reconnect is the user telling us they think it is broken — restart
    // the transport unconditionally rather than waiting for a probe to fail first.
    const restart = await restartTransport('manual_reconnect')
    if (!restart.ok) {
        const outcome = finishFailedRestart('manual_reconnect', restart)
        track('connection_manual_reconnect', {
            state_from: stateBefore,
            outcome: restart.reloadRequested ? `reload_${restart.reason}` : outcome,
        })
        return outcome
    }
    const outcome = await evaluateConnectionHealth({ trigger: 'manual_reconnect' })
    track('connection_manual_reconnect', { state_from: stateBefore, outcome })
    return outcome
}

/**
 * Called by appResume. Below the threshold a resume is a no-op — no network, no
 * UI movement — which is what keeps tabbing in and out of the app free.
 */
export const handleAppResume = ({ hiddenMs, probeAfterMs }) => {
    if (hiddenMs < probeAfterMs) return Promise.resolve(health)
    return evaluateConnectionHealth({ trigger: 'resume' })
}

/**
 * Installs the staleness monitor. The interval only ever *checks a clock*; it
 * performs I/O solely when the app has genuinely not heard from the server for
 * STALE_AFTER_MS, and it stands down while the tab is hidden (appResume owns the
 * wake-up) so a backgrounded phone pays nothing.
 */
export const installConnectionHealthMonitor = ({
    windowObject = typeof window === 'undefined' ? undefined : window,
    documentObject = typeof document === 'undefined' ? undefined : document,
    intervalMs = STALENESS_CHECK_INTERVAL_MS,
    staleAfterMs = STALE_AFTER_MS,
    ...injected
} = {}) => {
    deps = injected
    documentRef = documentObject || null
    if (!windowObject || !windowObject.addEventListener) return () => {}

    retryDelayMs = deps.staleRetryBaseMs || STALE_RETRY_BASE_MS
    lastServerContactAt = now()
    lastChangeAt = now()

    const tick = () => {
        if (documentIsHidden()) return
        if (manualOffline) return
        if (browserIsOffline()) {
            setHealth(CONNECTION_HEALTH_OFFLINE, 'monitor')
            return
        }
        if (health === CONNECTION_HEALTH_RECONNECTING) return
        const silentFor = getMillisSinceServerContact()
        if (silentFor === null || silentFor < staleAfterMs) return
        evaluateConnectionHealth({ trigger: 'staleness' }).catch(() => {})
    }

    const onOffline = () => {
        clearRetryTimer()
        setHealth(CONNECTION_HEALTH_OFFLINE, 'browser_offline')
    }

    const onOnline = () => {
        if (manualOffline) return
        // The browser's `online` event is optimistic (a captive portal fires it),
        // so recovery still has to be proven by a probe rather than assumed.
        evaluateConnectionHealth({ trigger: 'browser_online' }).catch(() => {})
    }

    const intervalId = setInterval(tick, intervalMs)
    windowObject.addEventListener('offline', onOffline)
    windowObject.addEventListener('online', onOnline)

    if (browserIsOffline()) setHealth(CONNECTION_HEALTH_OFFLINE, 'install')

    return () => {
        clearInterval(intervalId)
        clearRetryTimer()
        windowObject.removeEventListener('offline', onOffline)
        windowObject.removeEventListener('online', onOnline)
    }
}

export const resetConnectionHealthForTests = () => {
    clearRetryTimer()
    invalidateLatencySamples()
    health = CONNECTION_HEALTH_LIVE
    manualOffline = false
    lastServerContactAt = null
    lastChangeAt = null
    probeInFlight = null
    probeCycleId = 0
    retryDelayMs = STALE_RETRY_BASE_MS
    documentRef = null
    deps = {}
    healthListeners.clear()
}
