import { createSwipeCloseGuard } from './useSwipeCloseGuard'

/**
 * AT-2449 — "after swiping left on a task and dismissing the postpone popup by
 * clicking next to it, I can no longer click into the task in the task list view".
 *
 * The two orderings below are not hypotheticals: they are the two ways
 * `Swipeable._animateRow` actually emits this pair, and which one you get depends
 * only on whether the close has any distance to travel. Both are reproduced in
 * real Chromium by `browser-tests/at2449` against the real gesture handler; this
 * suite pins the rule that tells them apart, which is the part that has to stay
 * true under refactoring.
 */
describe('createSwipeCloseGuard', () => {
    const flushMicrotasks = () => Promise.resolve().then(() => {})

    it('blocks while a close is genuinely in flight, and releases when it lands', async () => {
        const setBlockOpen = jest.fn()
        const guard = createSwipeCloseGuard(setBlockOpen)

        // A close with distance to travel: the spring resolves frames later, so
        // the callbacks arrive in separate ticks and in the documented order.
        guard.onSwipeableWillClose()
        expect(setBlockOpen).toHaveBeenLastCalledWith(true)

        await flushMicrotasks()
        guard.onSwipeableClose()
        expect(setBlockOpen).toHaveBeenLastCalledWith(false)
    })

    // The reported defect. `TaskPresentation.onRightSwipe` (and the goal, contact,
    // note and chat rows) call `itemSwipe.current.close()` synchronously from
    // inside their own will-open handler, where `Swipeable._currentOffset()` still
    // answers 0 because the `rowState` setState has not flushed. The resulting
    // 0 → 0 spring settles INSIDE `.start()`, so the completion callback runs
    // before `_animateRow` reaches its `onSwipeableWillClose()` line.
    //
    // AT-2449 follow-up: the block may not be held by that close (it is over),
    // but it may not be dropped either — the GESTURE is still running and owes
    // the row a trailing click. So it is held to the end of the current turn,
    // and released without anything else having to happen.
    it('holds a settled close only until the end of the gesture', async () => {
        jest.useFakeTimers()
        try {
            const setBlockOpen = jest.fn()
            const guard = createSwipeCloseGuard(setBlockOpen)

            guard.onSwipeableClose()
            guard.onSwipeableWillClose()

            // The trailing click of the swipe arrives here, in this same task.
            expect(setBlockOpen).toHaveBeenLastCalledWith(true)

            jest.runOnlyPendingTimers()
            expect(setBlockOpen).toHaveBeenLastCalledWith(false)
        } finally {
            jest.useRealTimers()
        }
        await flushMicrotasks()
    })

    // The whole point of AT-2449: the block must not be able to outlive the
    // gesture, whatever else the row does. Nothing but the passage of a task is
    // required to clear it — no later close, no re-open, no press.
    it('cannot leave the row blocked once the gesture is over', async () => {
        jest.useFakeTimers()
        try {
            const setBlockOpen = jest.fn()
            const guard = createSwipeCloseGuard(setBlockOpen)

            // Exactly `_animateRow`'s emission order for a swipe that opens the
            // row and is closed from inside its own will-open handler.
            guard.onSwipeableClose()
            guard.onSwipeableWillClose()
            guard.onSwipeableWillOpen()

            // ... including the will-open that follows in the same `_animateRow`:
            // it must NOT be read as "this block is stale".
            expect(setBlockOpen).toHaveBeenLastCalledWith(true)

            jest.runOnlyPendingTimers()
            expect(setBlockOpen).toHaveBeenLastCalledWith(false)
        } finally {
            jest.useRealTimers()
        }
        await flushMicrotasks()
    })

    // The tick marker must not survive the tick that set it: a later, genuine
    // close has to block again, or the guard would silently stop doing its job
    // after the first swipe.
    it('goes back to blocking on the next tick', async () => {
        const setBlockOpen = jest.fn()
        const guard = createSwipeCloseGuard(setBlockOpen)

        guard.onSwipeableClose()
        guard.onSwipeableWillClose()
        await flushMicrotasks()

        guard.onSwipeableWillClose()
        expect(setBlockOpen).toHaveBeenLastCalledWith(true)
    })

    // A close whose animation is interrupted by a new open gesture never delivers
    // its completion callback at all. Without this the guard would stay set until
    // the row happened to be closed again.
    it('releases when the row opens instead of finishing its close', () => {
        const setBlockOpen = jest.fn()
        const guard = createSwipeCloseGuard(setBlockOpen)

        guard.onSwipeableWillClose()
        expect(setBlockOpen).toHaveBeenLastCalledWith(true)

        guard.onSwipeableWillOpen()
        expect(setBlockOpen).toHaveBeenLastCalledWith(false)
    })

    it('keeps one tick marker per row', async () => {
        const first = jest.fn()
        const second = jest.fn()
        const guardA = createSwipeCloseGuard(first)
        const guardB = createSwipeCloseGuard(second)

        // A settles synchronously; B is a normal animated close happening at the
        // same moment. B must still block.
        guardA.onSwipeableClose()
        guardB.onSwipeableWillClose()

        expect(first).toHaveBeenLastCalledWith(false)
        expect(second).toHaveBeenLastCalledWith(true)

        await flushMicrotasks()
    })
})
