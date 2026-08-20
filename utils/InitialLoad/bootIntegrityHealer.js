import store from '../../redux/store'
import { getDb, globalWatcherUnsub } from '../backends/firestore'
import { recoverDroppedProject } from './projectRecovery'
import { loadGlobalData, watchProjectData } from './initialLoadHelper'
import { isBrowserOffline } from '../connectionState'
import { runExclusiveFirestoreRestart } from '../backends/firestoreRestartLease'

/**
 * Post-boot integrity check for data a degraded initial load left behind.
 *
 * Production sessions (2026-08-13) showed the Firestore client intermittently reporting
 * existing documents as missing during boot — projects vanished from the sidebar and the
 * administrator user came back empty — and staying wrong for the WHOLE session: the wedged
 * Listen stream never delivered the data, so watcher-based recovery never got its trigger.
 * A manual reload "fixed" it only because it built a fresh connection.
 *
 * This module does what the reload does, without the reload. A few seconds after the initial
 * load (and again later, in case the first pass ran while the transport was still bad) it
 * compares what the user is entitled to with what redux actually holds:
 *   - every id in `loggedUser.projectIds` should be in `loggedUserProjectsMap`,
 *   - `administratorUser` should be populated whenever `roles/administrator` names a user.
 * On anomalies it first simply re-fetches (recoverDroppedProject / loadGlobalData). If data is
 * still missing after that, it cycles the Firestore network (disableNetwork → enableNetwork,
 * which tears down and re-establishes every stream — the reload-equivalent) and re-fetches
 * once more. Network cycles are bounded per session; a check never runs concurrently with
 * itself; and everything here only ever ADDS missing data, so a false anomaly is harmless.
 */

const CHECK_DELAYS_MS = [1000, 5000, 15000, 60000]
const MAX_NETWORK_CYCLES_PER_SESSION = 2
const RECHECK_AFTER_RECONNECT_MS = 3000

let scheduledUserId = null
let scheduledTimers = []
let running = false
let networkCyclesUsed = 0
let recheckWhenBackOnline = null

// The redux slice is debounced and is still '' during early boot (its listener is
// installed from a component that only mounts once login resolves), so the very
// first scheduled check at 1000ms would not see an offline browser at all.
const isOffline = () => store.getState().connectionState === 'offline' || isBrowserOffline()

const removeRecheckListener = () => {
    if (!recheckWhenBackOnline) return
    if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('online', recheckWhenBackOnline)
    }
    recheckWhenBackOnline = null
}

/**
 * A check skipped because we were offline is not a check that happened. Re-run it
 * once connectivity returns, rather than relying on a later scheduled pass that
 * may not exist.
 */
const scheduleRecheckWhenBackOnline = () => {
    if (recheckWhenBackOnline) return
    if (typeof window === 'undefined' || !window.addEventListener) return
    recheckWhenBackOnline = () => {
        removeRecheckListener()
        // Let the transport settle before deciding what is "missing".
        setTimeout(() => {
            runBootIntegrityCheck().catch(error => console.warn('[BootIntegrity] Check failed:', error))
        }, RECHECK_AFTER_RECONNECT_MS)
    }
    window.addEventListener('online', recheckWhenBackOnline)
}

export const resetBootIntegrityHealerForTests = () => {
    scheduledTimers.forEach(timer => clearTimeout(timer))
    scheduledTimers = []
    scheduledUserId = null
    running = false
    networkCyclesUsed = 0
    removeRecheckListener()
}

const findAnomalies = async () => {
    const { loggedUser, loggedUserProjectsMap, administratorUser } = store.getState()
    if (!loggedUser || !loggedUser.uid || loggedUser.isAnonymous) return null

    const projectIds = Array.isArray(loggedUser.projectIds) ? loggedUser.projectIds : []
    const missingProjectIds = projectIds.filter(projectId => !loggedUserProjectsMap[projectId])

    let administratorMissing = false
    if (!administratorUser?.uid) {
        try {
            const roleDoc = await getDb().doc('roles/administrator').get()
            administratorMissing = !!roleDoc.data()?.userId
        } catch (error) {
            // The role doc could not be read right now — nothing actionable this pass.
        }
    }

    if (missingProjectIds.length === 0 && !administratorMissing) return null
    return { missingProjectIds, administratorMissing }
}

const repairAnomalies = async ({ missingProjectIds, administratorMissing }) => {
    const repairs = missingProjectIds.map(projectId =>
        recoverDroppedProject(projectId).catch(error => {
            console.warn(`[BootIntegrity] Recovery of project ${projectId} failed:`, error)
            return false
        })
    )
    if (administratorMissing) {
        // loadGlobalData re-fetches whenever the administrator user is not loaded, and starts
        // the administrator watcher it skipped when the first fetch came back empty.
        repairs.push(
            loadGlobalData().catch(error => {
                console.warn('[BootIntegrity] Reloading global data failed:', error)
            })
        )
    }
    await Promise.all(repairs)

    // A stale cached user can reveal a project id only after the initial watcher list was built.
    // Recovery inserts that project's data, but without this guard it would never receive live
    // updates. Projects dropped by a bad document read already have watchers, so do not replace
    // (and leak) those existing subscriptions.
    missingProjectIds.forEach(projectId => {
        if (store.getState().loggedUserProjectsMap[projectId] && !globalWatcherUnsub[`${projectId}Project`]) {
            watchProjectData(projectId, true, true)
        }
    })
}

const cycleFirestoreNetwork = async () => {
    if (networkCyclesUsed >= MAX_NETWORK_CYCLES_PER_SESSION) return false
    networkCyclesUsed++
    // Through the shared lease (PT-4660): connection health restarts the same
    // transport when a probe fails, and interleaved disable/enable pairs resolve in
    // SDK call order — one ordering leaves the network parked for the rest of the
    // session while both callers believe they restored it.
    return runExclusiveFirestoreRestart(async () => {
        const db = getDb()
        try {
            await db.disableNetwork()
            await db.enableNetwork()
            console.warn('[BootIntegrity] Cycled the Firestore network connection to recover missing data')
        } catch (error) {
            console.warn('[BootIntegrity] Failed to cycle the Firestore network:', error)
            try {
                await db.enableNetwork()
            } catch (enableError) {
                // Nothing else to do — the SDK keeps its previous state.
            }
            // Reported as a failed cycle to the caller, which is what the `false`
            // return of runExclusiveFirestoreRestart means.
            throw error
        }
    })
}

export const runBootIntegrityCheck = async ({ settleMs = 1500 } = {}) => {
    if (running) return
    // Offline (OFFLINE_SUPPORT_PLAN.md Stage 3), "missing" data is just whatever the
    // IndexedDB cache has not seen — every pass would report anomalies, and the
    // network-cycle escalation would burn its two per-session uses tearing down a
    // connection that is not there.
    //
    // The scheduled checks do NOT keep firing: CHECK_DELAYS_MS are four one-shot
    // timers armed once per user, so a boot that is offline for the first 60s used
    // to consume all four and leave the healer dead for the rest of the session —
    // precisely the degraded boot it exists for. Re-arm on reconnect instead
    // (AT-2340).
    if (isOffline()) {
        scheduleRecheckWhenBackOnline()
        return
    }
    running = true
    try {
        const anomalies = await findAnomalies()
        if (!anomalies) return

        console.warn('[BootIntegrity] The initial load left data behind, repairing:', {
            missingProjectIds: anomalies.missingProjectIds,
            administratorMissing: anomalies.administratorMissing,
        })

        // First try plain re-fetches — often the transport has recovered on its own by now.
        await repairAnomalies(anomalies)

        const remaining = await findAnomalies()
        if (!remaining) {
            console.warn('[BootIntegrity] Repaired without reconnecting')
            return
        }

        // Still missing: the connection itself is suspect. Rebuild it, let the new streams
        // settle, then re-fetch once more — unless the browser went offline mid-check, in
        // which case the cycle would waste one of its two bounded uses on nothing.
        if (isOffline()) {
            scheduleRecheckWhenBackOnline()
            return
        }
        if (!(await cycleFirestoreNetwork())) return
        await new Promise(resolve => setTimeout(resolve, settleMs))
        await repairAnomalies(remaining)

        const afterReconnect = await findAnomalies()
        if (afterReconnect) {
            console.warn('[BootIntegrity] Still missing after reconnecting, next scheduled check will retry:', {
                missingProjectIds: afterReconnect.missingProjectIds,
                administratorMissing: afterReconnect.administratorMissing,
            })
        } else {
            console.warn('[BootIntegrity] Repaired after reconnecting')
        }
    } finally {
        running = false
    }
}

export const scheduleBootIntegrityChecks = () => {
    const userId = store.getState().loggedUser?.uid
    if (!userId || scheduledUserId === userId) return

    // The app can sign out and into another account without a page reload. Checks and network
    // cycle limits belong to the current user, not the lifetime of the JavaScript document.
    scheduledTimers.forEach(timer => clearTimeout(timer))
    scheduledTimers = []
    scheduledUserId = userId
    networkCyclesUsed = 0

    scheduledTimers = CHECK_DELAYS_MS.map(delay =>
        setTimeout(() => {
            runBootIntegrityCheck().catch(error => console.warn('[BootIntegrity] Check failed:', error))
        }, delay)
    )
}
