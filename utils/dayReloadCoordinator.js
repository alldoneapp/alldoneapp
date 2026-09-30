import { hasUnsafeCommentDrafts } from './commentDraftStore'
import { newDayRecoveryStore } from './newDayRecoveryStore'
import { hasPendingTaskWrites, subscribePendingTaskWrites } from './backends/pendingTaskWrites'

export const DAILY_APP_LOAD_DATE_STORAGE_KEY = 'alldone.lastFullAppLoadLocalDate'

// Both the lifecycle timer and the confirmation button use this one navigation
// lease. A popup hold covers editing; a separate submission hold covers saving.
export const createDayReloadCoordinator = ({ isSafe = () => true } = {}) => {
    const holds = new Set()
    let pending
    let started = false
    const retry = () => {
        if (started || holds.size || !pending || !isSafe() || !pending.canReload()) return false
        started = true
        const { reload } = pending
        pending = null
        reload()
        return true
    }
    return {
        retry,
        hold: () => {
            const token = {}
            holds.add(token)
            return () => {
                holds.delete(token)
                retry()
            }
        },
        request: (reload, canReload = () => true) => {
            if (started) return false
            if (!pending) pending = { reload, canReload }
            return retry()
        },
    }
}

// A task created while the day was loading can still be only in memory; the
// reload waits for its server ack and retries as soon as the last one lands.
export const dayReloadCoordinator = createDayReloadCoordinator({
    isSafe: () => !newDayRecoveryStore.hasUnsafeEntries() && !hasUnsafeCommentDrafts() && !hasPendingTaskWrites(),
})
subscribePendingTaskWrites(count => {
    if (!count) dayReloadCoordinator.retry()
})

export const markDailyReload = () => {
    try {
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const previous = localStorage.getItem(DAILY_APP_LOAD_DATE_STORAGE_KEY)
        if (!previous || previous < date) localStorage.setItem(DAILY_APP_LOAD_DATE_STORAGE_KEY, date)
    } catch (_) {}
}
