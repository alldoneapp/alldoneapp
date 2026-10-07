import firebase from 'firebase/compat/app'

export const STATISTICS_ERROR_REPORT_TIMEOUT_MS = 5000
export const STATISTICS_ERROR_REPORT_COOLDOWN_MS = 5 * 60 * 1000
const recentReports = new Map()
const shortText = (value, limit = 1000) => String(value || '').slice(0, limit)

// Use the existing create-only runtimeErrors collection, independently of the
// Firestore SDK queue that may have caused the failure. Reporting is best effort:
// neither token refresh nor an unreachable server may hold up the popup. Repeated
// taps report once per user/project/day/error/stage every five minutes.
export const reportNewDayStatisticsError = async (error, context) => {
    let timer
    let controller
    try {
        const user = firebase.auth().currentUser
        if (!user || user.uid !== context.userId) return false
        const now = Date.now()
        const code = shortText(error?.code || 'unknown', 100)
        const stage = shortText(context.stage || 'statistics-read', 100)
        const key = JSON.stringify([user.uid, context.projectId, context.statisticsDate, code, stage, context.eventId])
        for (const [reportKey, at] of recentReports) {
            if (now - at >= STATISTICS_ERROR_REPORT_COOLDOWN_MS) recentReports.delete(reportKey)
        }
        if (recentReports.has(key)) return false
        if (recentReports.size >= 100) recentReports.delete(recentReports.keys().next().value)
        recentReports.set(key, now)

        const values = {
            source: context.source === 'new-day-lifecycle' ? 'new-day-lifecycle' : 'new-day-statistics',
            eventId: shortText(context.eventId, 100),
            reason: shortText(context.reason, 100),
            acknowledgedDate: Number.isFinite(context.acknowledgedDate) ? context.acknowledgedDate : 0,
            previousDate: Number.isFinite(context.previousDate) ? context.previousDate : 0,
            userId: user.uid,
            projectId: shortText(context.projectId),
            statisticsDate: shortText(context.statisticsDate, 20),
            datetime:
                context.source === 'new-day-lifecycle' && Number.isFinite(context.eventTime) ? context.eventTime : now,
            errorCode: code,
            errorMessage: shortText(error?.message || 'Statistics could not be loaded'),
            errorStackTrace: shortText(error?.stack, 4000),
            cacheErrorCode: shortText(error?.cacheError?.code, 100),
            cacheErrorMessage: shortText(error?.cacheError?.message),
            stage,
            attempt: Number.isFinite(context.attempt) ? context.attempt : 0,
            elapsedMs: Number.isFinite(context.elapsedMs) ? context.elapsedMs : 0,
            connectionHealth: shortText(context.connectionHealth, 100),
            connectionState: shortText(context.connectionState, 100),
            userAgent: typeof navigator === 'undefined' ? '' : shortText(navigator.userAgent, 500),
        }
        const fields = Object.fromEntries(
            Object.entries(values).map(([name, value]) => [
                name,
                typeof value === 'number' ? { integerValue: String(Math.round(value)) } : { stringValue: value },
            ])
        )
        controller = new AbortController()
        const signal = controller.signal
        const send = async () => {
            const token = await user.getIdToken()
            if (signal.aborted || firebase.auth().currentUser?.uid !== user.uid) return false
            const { projectId, apiKey } = firebase.app().options
            const emulator = typeof window !== 'undefined' && window.location?.search.includes('emulator=true')
            const origin = emulator ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com'
            const url = `${origin}/v1/projects/${projectId}/databases/(default)/documents/runtimeErrors`
            const response = await fetch(`${url}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields }),
                signal,
            })
            return response.ok
        }
        return await Promise.race([
            send(),
            new Promise(resolve => {
                timer = setTimeout(() => {
                    controller.abort()
                    resolve(false)
                }, STATISTICS_ERROR_REPORT_TIMEOUT_MS)
            }),
        ])
    } catch (reportError) {
        return false
    } finally {
        clearTimeout(timer)
    }
}
