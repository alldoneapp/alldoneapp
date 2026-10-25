import firebase from 'firebase/compat/app'
import { reportNewDayStatisticsError } from './backends/Users/reportNewDayStatisticsError'

const KEY = 'alldone.newDayDiagnostics.v1'
const inflight = new Set()
const read = () => {
    try {
        const entries = JSON.parse(localStorage.getItem(KEY) || '[]')
        return Array.isArray(entries)
            ? entries.filter(entry => entry && typeof entry.userId === 'string' && typeof entry.eventId === 'string')
            : []
    } catch (_) {
        return []
    }
}
const save = entries => {
    try {
        localStorage.setItem(KEY, JSON.stringify(entries.slice(-30)))
    } catch (_) {}
}

// A short journal survives the navigation itself. Only identifiers, dates and
// lifecycle stages are recorded; ratings, comments and credentials are excluded.
export const flushNewDayDiagnostics = async userId => {
    const entries = read()
    await Promise.all(
        entries
            .filter(entry => entry.userId === userId && !inflight.has(entry.eventId))
            .map(async entry => {
                inflight.add(entry.eventId)
                try {
                    const sent = await reportNewDayStatisticsError(
                        { code: entry.errorCode || 'lifecycle', message: entry.stage },
                        entry
                    )
                    if (sent) save(read().filter(candidate => candidate.eventId !== entry.eventId))
                } catch (_) {
                    // Keep the journal for the next authenticated boot.
                } finally {
                    inflight.delete(entry.eventId)
                }
            })
    )
}

export const recordNewDayEvent = (stage, context = {}) => {
    let userId = context.userId
    try {
        userId = userId || firebase.auth().currentUser?.uid
    } catch (_) {}
    if (!userId) return
    const entry = {
        source: 'new-day-lifecycle',
        eventTime: Date.now(),
        userId,
        stage,
        eventId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        reason: context.reason || '',
        acknowledgedDate: context.acknowledgedDate,
        previousDate: context.previousDate,
        errorCode: context.errorCode,
        connectionState: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
    }
    save([...read(), entry])
    void flushNewDayDiagnostics(userId).catch(() => {})
}
