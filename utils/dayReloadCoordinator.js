import { newDayRecoveryStore } from './newDayRecoveryStore'

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

export const dayReloadCoordinator = createDayReloadCoordinator({
    isSafe: () => !newDayRecoveryStore.hasUnsafeEntries(),
})

export const markDailyReload = () => {
    try {
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const previous = localStorage.getItem(DAILY_APP_LOAD_DATE_STORAGE_KEY)
        if (!previous || previous < date) localStorage.setItem(DAILY_APP_LOAD_DATE_STORAGE_KEY, date)
    } catch (_) {}
}
