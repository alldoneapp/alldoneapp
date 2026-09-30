/**
 * Is a task created in THIS page still waiting for its server ack?
 *
 * Firestore makes a write durable only when its AsyncQueue reaches the local
 * IndexedDB write, and on a busy phone that can take tens of seconds. Until
 * then the write exists only in this document's memory, so any page reload
 * discards it while the optimistic row made it look saved. Automatic reloads
 * (the new-day reload, Firestore client replacement) ask this before they run.
 *
 * Kept as a leaf module: taskWriteMonitor reaches connectionHealth, which
 * reaches firestoreFatalRecovery, so the reload paths cannot import the
 * monitor itself without a cycle.
 */
let pendingCount = 0
const listeners = new Set()

export const setPendingTaskWriteCount = count => {
    const next = Math.max(0, Number(count) || 0)
    if (next === pendingCount) return
    pendingCount = next
    listeners.forEach(listener => {
        try {
            listener(pendingCount)
        } catch (_) {}
    })
}

export const hasPendingTaskWrites = () => pendingCount > 0

export const subscribePendingTaskWrites = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
