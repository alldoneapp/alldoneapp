import store from '../../redux/store'
import { getDb } from '../backends/firestore'
import { recoverDroppedProject } from './projectRecovery'
import { loadGlobalData } from './initialLoadHelper'

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

const CHECK_DELAYS_MS = [10000, 45000, 120000]
const MAX_NETWORK_CYCLES_PER_SESSION = 2

let scheduled = false
let running = false
let networkCyclesUsed = 0

export const resetBootIntegrityHealerForTests = () => {
    scheduled = false
    running = false
    networkCyclesUsed = 0
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
}

const cycleFirestoreNetwork = async () => {
    if (networkCyclesUsed >= MAX_NETWORK_CYCLES_PER_SESSION) return false
    networkCyclesUsed++
    const db = getDb()
    try {
        await db.disableNetwork()
        await db.enableNetwork()
        console.warn('[BootIntegrity] Cycled the Firestore network connection to recover missing data')
        return true
    } catch (error) {
        console.warn('[BootIntegrity] Failed to cycle the Firestore network:', error)
        try {
            await db.enableNetwork()
        } catch (enableError) {
            // Nothing else to do — the SDK keeps its previous state.
        }
        return false
    }
}

export const runBootIntegrityCheck = async ({ settleMs = 1500 } = {}) => {
    if (running) return
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
        // settle, then re-fetch once more.
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
    if (scheduled) return
    scheduled = true
    CHECK_DELAYS_MS.forEach(delay => {
        setTimeout(() => {
            runBootIntegrityCheck().catch(error => console.warn('[BootIntegrity] Check failed:', error))
        }, delay)
    })
}
