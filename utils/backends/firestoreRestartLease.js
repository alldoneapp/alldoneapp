/**
 * One lease for every Firestore transport restart in the app (PT-4660).
 *
 * A "restart" is `disableNetwork()` followed by `enableNetwork()` — it tears down
 * and rebuilds every Listen stream, which is the reload-equivalent the boot
 * integrity healer already relies on to recover a wedged connection.
 *
 * Two independent modules now want to do that: `bootIntegrityHealer` (data that a
 * degraded boot left behind) and `connectionHealth` (a transport that died while
 * the browser still claims to be online). Interleaving them is the one thing that
 * must not happen — `disableNetwork` and `enableNetwork` are queued by the SDK in
 * call order, so healer(disable) → health(disable) → healer(enable) →
 * health(enable) leaves the network *enabled* only by luck of ordering, and the
 * reverse interleaving parks the transport for the rest of the session while both
 * callers believe they restored it.
 *
 * The lease serializes them instead of trying to coordinate them: a restart runs
 * alone, and a caller that arrives while one is in flight joins the in-flight
 * restart rather than starting a second one. Each caller keeps its own budget
 * (the healer's two-per-session cap, this module's backoff) — the lease only
 * owns mutual exclusion.
 */

let inFlight = null

/**
 * Runs `restart` exclusively. While a restart is in flight every other caller
 * receives that same promise, so a burst of suspicion (resume + staleness +
 * manual button) cycles the network once, not three times.
 *
 * Never rejects: a failed restart is reported as `false` so callers can fall
 * through to their own degraded path instead of unwinding into an unhandled
 * rejection on a purely best-effort recovery.
 */
export const runExclusiveFirestoreRestart = restart => {
    if (inFlight) return inFlight

    const run = async () => {
        try {
            await restart()
            return true
        } catch (error) {
            console.warn('[Firestore] Transport restart failed:', error)
            return false
        }
    }

    inFlight = run().finally(() => {
        inFlight = null
    })
    return inFlight
}

export const isFirestoreRestartInFlight = () => inFlight !== null

export const resetFirestoreRestartLeaseForTests = () => {
    inFlight = null
}
