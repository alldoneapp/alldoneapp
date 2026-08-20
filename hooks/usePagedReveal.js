import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * AT-2385 — "Show more" for a list whose data is ALREADY in memory.
 *
 * `useLoadingMore` covers the other shape: a press widens a Firestore `limit(n)` and the
 * ghosts are retired by the arriving snapshot. Contacts have no such wait — the whole
 * project contact set is in redux before the view mounts (see `watchProjectContacts`) —
 * so the thing the user waits for is not the network, it is the RENDER.
 *
 * That render is not cheap and it is not theoretical. Every revealed `ContactItem` mounts
 * a `Swipeable`, subscribes to the redux store, and opens its OWN `watchBacklinksCount`
 * Firestore listener. Before this hook, one press of the chevron set a boolean that
 * revealed *every* remaining contact at once, so a project with a few hundred contacts
 * mounted a few hundred of those rows synchronously inside the press handler — a frozen
 * tab and a burst of listeners, from one tap.
 *
 * So the hook does two things:
 *
 *   1. Reveals a fixed PAGE per press instead of the whole remainder, which is what
 *      actually bounds the cost.
 *   2. Splits "what the user asked for" (`requestedAmount`) from "what is on screen"
 *      (`revealedAmount`) and commits the difference AFTER the current frame has painted.
 *      `requestedAmount > revealedAmount` is therefore a real interval — the press
 *      responds instantly with ghosts, and the expensive mount happens off the handler.
 *      This mirrors `useEarlierTasks`'s `loadedAmount !== tasksAmountToWatch`, which is
 *      the same "asked for more than I have" derivation applied to a network page.
 *
 * Deliberately NOT React's `useTransition`, even though it expresses the same idea:
 * under `act()` a transition flushes synchronously, so `isPending` is never observable
 * and the ghosts could not be pinned by a regression test. Verified, not assumed.
 */

// The backstop. `requestAnimationFrame` does not fire in a background tab, so a user who
// presses the chevron and immediately switches tabs would otherwise come back to ghosts
// that never became rows. This fires the reveal itself rather than merely clearing the
// flag — the content the user asked for must arrive either way.
export const PAGED_REVEAL_TIMEOUT_MS = 8000

/**
 * Runs `callback` after the browser has painted the frame we are currently committing.
 * Two frames are required, not one: rAF callbacks run AFTER React's commit but BEFORE the
 * paint of that same frame, so a single rAF would swap the ghosts out before they were
 * ever visible. Returns its own canceller.
 */
export const scheduleAfterPaint = callback => {
    if (typeof requestAnimationFrame !== 'function') {
        const timer = setTimeout(callback, 0)
        return () => clearTimeout(timer)
    }

    let innerFrame = null
    const outerFrame = requestAnimationFrame(() => {
        innerFrame = requestAnimationFrame(callback)
    })

    return () => {
        cancelAnimationFrame(outerFrame)
        if (innerFrame !== null) cancelAnimationFrame(innerFrame)
    }
}

/**
 * @param totalCount  how many items the (already filtered and sorted) list holds
 * @param pageSize    how many more to reveal per press
 * @param options.initialAmount  the collapsed size; defaults to one page
 * @param options.schedule       injectable for tests; must return a canceller
 */
export default function usePagedReveal(totalCount, pageSize, options = {}) {
    const { initialAmount = pageSize, timeoutMs = PAGED_REVEAL_TIMEOUT_MS, schedule = scheduleAfterPaint } = options

    const safeInitialAmount = Math.max(0, initialAmount)
    const [revealedAmount, setRevealedAmount] = useState(safeInitialAmount)
    const [requestedAmount, setRequestedAmount] = useState(safeInitialAmount)

    // The collapsed size is a prop of the surrounding view (Contacts shows 3 per project in
    // all-projects mode and 10 in a single project), so switching projects changes it. An
    // expansion belongs to the list it was made on and must not survive that switch.
    const initialAmountRef = useRef(safeInitialAmount)
    useEffect(() => {
        if (initialAmountRef.current === safeInitialAmount) return
        initialAmountRef.current = safeInitialAmount
        setRevealedAmount(safeInitialAmount)
        setRequestedAmount(safeInitialAmount)
    }, [safeInitialAmount])

    const loadingMore = requestedAmount > revealedAmount

    useEffect(() => {
        if (!loadingMore) return undefined

        const reveal = () => setRevealedAmount(requestedAmount)
        const cancelSchedule = schedule(reveal)
        const timer = setTimeout(reveal, timeoutMs)

        return () => {
            if (typeof cancelSchedule === 'function') cancelSchedule()
            clearTimeout(timer)
        }
    }, [loadingMore, requestedAmount, schedule, timeoutMs])

    const expand = useCallback(() => {
        // Re-entrancy guard, same reason as `NotesByProject.expandShowMore`: while the
        // ghosts are up the reveal is already scheduled, and a second press would only
        // move the target while the user reads it as progress.
        if (loadingMore) return
        const next = Math.min(totalCount, revealedAmount + Math.max(1, pageSize))
        if (next <= revealedAmount) return
        setRequestedAmount(next)
    }, [loadingMore, pageSize, revealedAmount, totalCount])

    const collapse = useCallback(() => {
        // Collapsing only UNMOUNTS rows, so there is nothing to wait for and no ghosts:
        // showing them here would claim work that is already done.
        setRequestedAmount(initialAmountRef.current)
        setRevealedAmount(initialAmountRef.current)
    }, [])

    return {
        visibleAmount: revealedAmount,
        // What the ghosts should cover: exactly the batch that was requested and has not
        // landed yet. Zero whenever nothing is in flight.
        incomingCount: loadingMore ? requestedAmount - revealedAmount : 0,
        loadingMore,
        // A filter can shrink the list under the collapsed size while it is expanded; the
        // collapse affordance would then point at nothing, so it is gated on the list
        // still being longer than one page.
        expanded: revealedAmount > safeInitialAmount && totalCount > safeInitialAmount,
        canExpand: totalCount > revealedAmount,
        expand,
        collapse,
    }
}
