// The foreground task query for every active project starts concurrently so a task-bearing
// project is never hidden behind a run of empty projects. The complete queries are different:
// once each project has published its first visible rows, starting every unbounded query together
// would recreate the same IndexedDB/Firestore fan-out in the background and can still stall the UI.
// Admit only a small number of complete initial snapshots at a time. A listener stops occupying a
// slot as soon as its first usable snapshot arrives; it stays subscribed for realtime updates.
export const OPEN_TASKS_BACKGROUND_HYDRATION_CONCURRENCY = 2

const pendingEntries = []
const activeEntries = new Set()

const removePendingEntry = entry => {
    const index = pendingEntries.indexOf(entry)
    if (index >= 0) pendingEntries.splice(index, 1)
}

const pump = () => {
    while (activeEntries.size < OPEN_TASKS_BACKGROUND_HYDRATION_CONCURRENCY && pendingEntries.length > 0) {
        const entry = pendingEntries.shift()
        if (entry.cancelled) continue

        entry.started = true
        activeEntries.add(entry)
        entry.start(entry.finish)
    }
}

export const enqueueOpenTasksBackgroundHydration = start => {
    const entry = {
        cancelled: false,
        finished: false,
        started: false,
        start,
        finish: null,
    }

    entry.finish = () => {
        if (entry.finished) return
        entry.finished = true
        activeEntries.delete(entry)
        pump()
    }

    pendingEntries.push(entry)
    pump()

    return () => {
        if (entry.cancelled) return
        entry.cancelled = true
        if (entry.started) entry.finish()
        else removePendingEntry(entry)
    }
}

// Test-only state reset. Production callers own individual cancellation handles; exposing a reset
// keeps Jest modules isolated without teaching the queue about project or user identifiers.
export const resetOpenTasksBackgroundHydrationQueue = () => {
    pendingEntries.splice(0, pendingEntries.length)
    activeEntries.clear()
}
