import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * AT-2382 — "a bigger page was asked for and has not arrived yet".
 *
 * Every paginated list in this app expands the same way: a press widens a Firestore
 * `limit(n)` and the *old* rows are deliberately left on screen until the wider snapshot
 * lands (see the comment in `GlobalProject.js`). None of those call sites had a signal for
 * that in-between window, and the obvious candidate — the global `isLoadingData` refcount —
 * is unusable: several producers stop it more often than they start it, so it clamps to 0
 * and reads "idle" while a page is still in flight.
 *
 * So the signal is derived from the data itself. `snapshotSignal` is whatever value the
 * watcher replaces on every delivery (the chats-by-date map, the messages array…). Those
 * watchers all build a fresh object per snapshot, so a change of IDENTITY is a reliable
 * "something arrived" edge — and it stays correct when the new page turns out to be empty,
 * which a length comparison would miss and leave ghosting forever.
 *
 * The timeout is the backstop for the case where nothing ever arrives (offline, a query
 * that errors, a listener torn down by a route change). Ghosts that never retire are worse
 * than no ghosts at all: they claim the list is still growing when it is not.
 */
export const LOADING_MORE_TIMEOUT_MS = 8000

export default function useLoadingMore(snapshotSignal, { timeoutMs = LOADING_MORE_TIMEOUT_MS } = {}) {
    const [loadingMore, setLoadingMore] = useState(false)
    // `startLoadingMore` is called from a press handler, which runs before this effect
    // could see the same render — so the flag survives its own render and is only cleared
    // by the NEXT change of `snapshotSignal`, i.e. by a genuinely new delivery.
    const hasMountedRef = useRef(false)

    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true
            return
        }
        setLoadingMore(false)
    }, [snapshotSignal])

    useEffect(() => {
        if (!loadingMore) return undefined
        const timer = setTimeout(() => setLoadingMore(false), timeoutMs)
        return () => clearTimeout(timer)
    }, [loadingMore, timeoutMs])

    const startLoadingMore = useCallback(() => setLoadingMore(true), [])

    return [loadingMore, startLoadingMore]
}
