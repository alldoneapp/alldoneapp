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
    it('never blocks for a close that has already settled in the same tick', async () => {
        const setBlockOpen = jest.fn()
        const guard = createSwipeCloseGuard(setBlockOpen)

        guard.onSwipeableClose()
        guard.onSwipeableWillClose()

        expect(setBlockOpen).toHaveBeenCalledTimes(1)
        expect(setBlockOpen).toHaveBeenLastCalledWith(false)

        await flushMicrotasks()
        expect(setBlockOpen).toHaveBeenLastCalledWith(false)
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
