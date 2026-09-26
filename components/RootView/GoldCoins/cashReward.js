import { getTaskEarnings, formatEarnings } from './cashFlight'
import { loadGoldCoinsOverlay } from './loadGoldCoinsOverlay'

/**
 * Called from the task completion paths, next to the done-time statistics update. When the task
 * earned the logged-in user real money (the project has an hourly rate for them and the task an
 * estimate), banknotes burst out of the task's checkbox on the shared 3D overlay. Everything that
 * could make this cost anything on the completion path is deferred: the overlay and its WebGL check
 * are loaded lazily, nothing is awaited, and every failure is silent — it is a flourish, and the
 * gold coins still play either way.
 */
export function celebrateTaskEarnings({ project, userId, loggedUserId, estimationMinutes, checkBoxId }) {
    try {
        if (!userId || userId !== loggedUserId || !checkBoxId || typeof document === 'undefined') return
        const earnings = getTaskEarnings(project, userId, estimationMinutes)
        if (!earnings) return
        const { canRenderSkyline } = require('../../SettingsView/Profile/Achievements/Skyline/webglSupport')
        const { currentReducedMotionPreference } = require('../../UIComponents/Ghosts/ghostAnimation')
        if (!canRenderSkyline() || currentReducedMotionPreference()) return
        const checkBox = document.querySelector(`[check-box-id="${checkBoxId}"]`)
        if (!checkBox) return
        const rect = checkBox.getBoundingClientRect()
        const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        const locale = (typeof navigator !== 'undefined' && navigator.language) || undefined
        loadGoldCoinsOverlay()
            .then(({ launchCash }) =>
                launchCash({
                    from,
                    amount: earnings.amount,
                    currency: earnings.currency,
                    label: formatEarnings(earnings.amount, earnings.currency, locale),
                })
            )
            .catch(() => {})
    } catch (error) {
        // Never let a flourish break completing a task.
    }
}
