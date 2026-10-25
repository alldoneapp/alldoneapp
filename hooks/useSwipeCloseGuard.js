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
 * The two orderings are told apart by the microtask checkpoint, because both
 * callbacks of an inverted pair are emitted inside the same synchronous
 * `_animateRow` call, while a real animation resolves in a later task. A
 * genuinely animated close therefore still blocks from `willClose` to `close`,
 * exactly as it always did; what the inverted pair gets instead is described
 * under the follow-up below. Nothing here is a grace period — the flag can
 * never outlive the gesture that set it.
 *
 * `onSwipeableWillOpen` is handled too, as a second guarantee: a close whose
 * animation is INTERRUPTED by a new open gesture never delivers its completion
 * callback at all, which would otherwise leave the guard set until the row is
 * closed again. A row that is opening is by definition not closing.
 *
 * ---------------------------------------------------------------------------
 * AT-2449 follow-up — a settled close still has a GESTURE to see out.
 *
 * The first version of this guard read "already settled" as "nothing to block"
 * and left `blockOpen` false. That is right about the ANIMATION and wrong about
 * the INTERACTION, and the difference is a browser fact: a mouse drag ends with
 * `mouseup` AND a trailing `click`, dispatched in the same task, at the release
 * point — i.e. on the row that was just swiped. Every row here turns that click
 * into a press on its title, so the flag being stuck `true` was, by accident,
 * also what stopped a swipe from being read as a tap on the row it swiped.
 *
 * With it gone, swiping a GOAL row in the task list opened the goal's edit mode
 * instead of the postpone popup — and then made the popup impossible, because
 * `GoalItemPresentation` schedules that dispatch on a `setTimeout` and clears
 * `this.timeouts` in `componentWillUnmount`, so opening edit mode CANCELS the
 * popup it was supposed to show. The same shape is latent on the contact and
 * note rows, whose swipe handlers also defer their popup by a `setTimeout`
 * while their press target navigates to a detailed view. The task row is the
 * one that never showed it: `TaskPresentation.onRightSwipe` dispatches
 * synchronously, and `TaskItem.toggleModal` refuses to open edit mode while
 * `showSwipeDueDatePopup.visible` — so by the time the trailing click lands
 * there is already a reason to ignore it.
 *
 * So the rule is not "settled ⇒ do not block" but "settled ⇒ block only for as
 * long as the gesture lasts". That end is a real, observed boundary rather than
 * a grace period: the trailing click rides in the same task as the `mouseup`
 * that started all of this, so the FIRST MACROTASK after it is already past the
 * click. It is the same boundary the rows themselves use — their deferred
 * `setTimeout(...)` popups run in that turn too, scheduled just after this one,
 * so the row unblocks and its popup opens in a fixed order rather than a raced
 * one.
 *
 * This is a mouse-only hazard, which is why the release can be that tight. A
 * browser only synthesises a `click` for a touch sequence it judges a TAP, and a
 * swipe past `rightThreshold` (80px) is an order of magnitude past the tap slop,
 * so a touch drag produces no trailing click to block. Note the direction of the
 * risk if that were ever wrong: this holds the block strictly longer than the
 * first version of the guard and strictly shorter than the behaviour that
 * shipped for years before AT-2449, so it cannot be worse than either.
 */
export const createSwipeCloseGuard = setBlockOpen => {
    // Set for the remainder of the current synchronous block whenever a close
    // settles. Cleared on the microtask checkpoint, i.e. before any callback of
    // a genuinely animated close can arrive.
    let settledInThisTick = false
    let releaseScheduled = false
    // True while this tick's gesture — not an animation — is what is holding the
    // block. Nothing that runs later in the same tick may clear it.
    let gestureBlockActive = false

    const releaseAfterThisTick = () => {
        if (releaseScheduled) return
        releaseScheduled = true
        Promise.resolve().then(() => {
            releaseScheduled = false
            settledInThisTick = false
        })
    }

    const blockUntilGestureEnds = () => {
        if (gestureBlockActive) return
        gestureBlockActive = true
        setBlockOpen(true)
        setTimeout(() => {
            gestureBlockActive = false
            setBlockOpen(false)
        })
    }

    return {
        onSwipeableWillClose: () => {
            if (settledInThisTick) {
                blockUntilGestureEnds()
                return
            }
            setBlockOpen(true)
        },
        onSwipeableClose: () => {
            settledInThisTick = true
            releaseAfterThisTick()
            // A close that arrives while this tick's gesture block is up is the
            // very close that gesture performed; releasing here would undo the
            // block before the trailing click it exists for.
            if (!gestureBlockActive) setBlockOpen(false)
        },
        onSwipeableWillOpen: () => {
            // The row is opening as part of the SAME gesture that just blocked
            // it (`onSwipeableRightWillOpen` → the row's own `close()` →
            // `onSwipeableWillClose`, all inside one `_animateRow`). Only a
            // block left behind by an earlier, interrupted close is stale.
            if (gestureBlockActive) return
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
