import { useRef, useState } from 'react'

/**
 * AT-2449 — the "a swipe close is in flight, so ignore presses" flag, made
 * immune to the callback order `Swipeable` actually delivers.
 *
 * Every swipeable row in this app (task, goal, contact, note, chat message)
 * carries the same two-line pattern:
 *
 *     onSwipeableWillClose={() => setBlockOpen(true)}
 *     onSwipeableClose={() => setBlockOpen(false)}
 *
 * It exists so the tap that closes an open swipe row is not ALSO read as a tap
 * that opens the row, and it reads as obviously correct: "will close" comes
 * before "closed". **It does not.**
 *
 * `react-native-gesture-handler@1.5.6`'s `Swipeable._animateRow` starts the
 * spring and only afterwards calls the `will*` callbacks (Swipeable.js:203-242):
 *
 *     rowTranslation.setValue(fromValue)
 *     this.setState({ rowState: Math.sign(toValue) })
 *     Animated.spring(rowTranslation, { toValue, ... }).start(({ finished }) => {
 *         if (finished && toValue === 0) this.props.onSwipeableClose()   // (2)
 *     })
 *     if (toValue === 0) this.props.onSwipeableWillClose()               // (1)
 *
 * That is harmless while the row has somewhere to travel — the spring resolves
 * frames later, so (1) really does precede (2). But a close with **nothing to
 * animate** settles synchronously inside `.start()`: react-native-web's
 * `SpringAnimation.onUpdate` runs immediately, sees zero displacement and zero
 * velocity, and fires the completion callback before `start()` returns. Then (2)
 * runs before (1), the row is left with `blockOpen === true` and **no further
 * event ever clears it** — the row is permanently unopenable.
 *
 * A zero-distance close is not exotic here: it is what every one of these rows
 * does on a swipe. They all call `itemSwipe.current.close()` synchronously from
 * inside their own `onSwipeableRightWillOpen`/`onSwipeableLeftWillOpen`, and at
 * that moment the `setState({ rowState: -1 })` from the OPEN `_animateRow` a few
 * statements earlier has not flushed (React 18 batches updates from native event
 * handlers), so `Swipeable._currentOffset()` still answers `0`. `close()`
 * therefore animates 0 → 0. The reported symptom is "after swiping a task and
 * dismissing the postpone popup I can no longer click into the task": the swipe
 * wedges the row immediately, and the popup — which blocks the whole list while
 * it is up — is simply what hides it until then.
 *
 * The rule this guard applies: **a close that has already settled has nothing in
 * flight to block.** The two orderings are told apart by the microtask
 * checkpoint, because both callbacks of an inverted pair are emitted inside the
 * same synchronous `_animateRow` call, while a real animation resolves in a
 * later task. Nothing here is a timeout or a grace period; the flag can never
 * outlive the tick that set it.
 *
 * `onSwipeableWillOpen` is handled too, as a second guarantee: a close whose
 * animation is INTERRUPTED by a new open gesture never delivers its completion
 * callback at all, which would otherwise leave the guard set until the row is
 * closed again. A row that is opening is by definition not closing.
 */
export const createSwipeCloseGuard = setBlockOpen => {
    // Set for the remainder of the current synchronous block whenever a close
    // settles. Cleared on the microtask checkpoint, i.e. before any callback of
    // a genuinely animated close can arrive.
    let settledInThisTick = false
    let releaseScheduled = false

    const releaseAfterThisTick = () => {
        if (releaseScheduled) return
        releaseScheduled = true
        Promise.resolve().then(() => {
            releaseScheduled = false
            settledInThisTick = false
        })
    }

    return {
        onSwipeableWillClose: () => {
            if (settledInThisTick) return
            setBlockOpen(true)
        },
        onSwipeableClose: () => {
            settledInThisTick = true
            releaseAfterThisTick()
            setBlockOpen(false)
        },
        onSwipeableWillOpen: () => {
            setBlockOpen(false)
        },
    }
}

export default function useSwipeCloseGuard() {
    const [blockOpen, setBlockOpen] = useState(false)
    // One guard per row instance, created once: its closure is the whole state
    // machine, so re-creating it on every render would forget the tick it is in.
    const guard = useRef(null)
    if (guard.current === null) guard.current = createSwipeCloseGuard(setBlockOpen)

    return { blockOpen, ...guard.current }
}
