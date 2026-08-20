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
 *   reconnecting  a probe failed once; the transport has been restarted and is being re-probed
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

export const CONNECTION_HEALTH_LIVE = 'live'
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

/** Backoff between re-probes while stale, doubling from the first value up to the cap. */
export const STALE_RETRY_BASE_MS = 5000
export const STALE_RETRY_MAX_MS = 60 * 1000

const HEALTH_STATES = new Set([
    CONNECTION_HEALTH_LIVE,
    CONNECTION_HEALTH_RECONNECTING,
    CONNECTION_HEALTH_STALE,
    CONNECTION_HEALTH_OFFLINE,
])

let health = CONNECTION_HEALTH_LIVE
let lastServerContactAt = null
let lastChangeAt = null
let probeInFlight = null
let retryTimer
let retryDelayMs = STALE_RETRY_BASE_MS

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

export const getMillisSinceServerContact = () => (lastServerContactAt === null ? null : now() - lastServerContactAt)

const clearRetryTimer = () => {
    if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
    }
}

const setHealth = (nextHealth, trigger) => {
    if (!HEALTH_STATES.has(nextHealth) || nextHealth === health) return
    const previous = health
    const changedAt = now()
    const durationMs = lastChangeAt === null ? 0 : changedAt - lastChangeAt
    health = nextHealth
    lastChangeAt = changedAt

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
}

/**
 * A server snapshot arrived — the single positive proof the transport is alive.
 * Called from the cached-snapshot gate, which already distinguishes server from
 * cache, and from a successful probe.
 */
export const markServerContact = (trigger = 'snapshot') => {
    lastServerContactAt = now()
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

const restartTransport = () =>
    runExclusiveFirestoreRestart(async () => {
        const db = getDbSafe()
        if (!db || typeof db.disableNetwork !== 'function') return
        await db.disableNetwork()
        await db.enableNetwork()
    })

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

const runProbeCycle = async trigger => {
    if (browserIsOffline()) {
        setHealth(CONNECTION_HEALTH_OFFLINE, trigger)
        return health
    }

    const first = await probeServer()
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

    // One failure is not a verdict. Rebuild the transport — the reload-equivalent —
    // and ask again. Exactly one restart per cycle, through the shared lease so it
    // can never interleave with the boot integrity healer's own cycles.
    setHealth(CONNECTION_HEALTH_RECONNECTING, trigger)
    await restartTransport()

    const second = await probeServer()
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
    if (probeInFlight) return probeInFlight
    clearRetryTimer()
    probeInFlight = runProbeCycle(trigger)
        .catch(error => {
            console.warn('[ConnectionHealth] Probe cycle failed:', error)
            return health
        })
        .finally(() => {
            probeInFlight = null
        })
    return probeInFlight
}

/** The "Reconnect now" button. Always probes, whatever the current state. */
export const reconnectNow = async () => {
    const stateBefore = health
    setHealth(CONNECTION_HEALTH_RECONNECTING, 'manual_reconnect')
    // A manual reconnect is the user telling us they think it is broken — restart
    // the transport unconditionally rather than waiting for a probe to fail first.
    await restartTransport()
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
    health = CONNECTION_HEALTH_LIVE
    lastServerContactAt = null
    lastChangeAt = null
    probeInFlight = null
    retryDelayMs = STALE_RETRY_BASE_MS
    documentRef = null
    deps = {}
}
