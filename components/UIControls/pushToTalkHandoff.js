/**
 * Hands a press-and-hold that started on ONE control over to the dictation mic of another (AT-2823).
 *
 * Holding the floating "+" of the task board has to behave exactly like holding the mic inside the
 * add-task popup: same ring, same slide-to-cancel, same timer and level meter, and the same
 * release → transcribe → create-task ending (AT-2405 / AT-2408). Rebuilding any of that next to
 * the "+" would be a second recording experience that drifts from the first, so the "+" does not
 * record at all. It opens the popup and hands the gesture still in progress to the popup's
 * `RambleButton`, which then runs its ordinary push-to-talk path as if the finger had landed on it.
 *
 * The physical gesture stays owned by the "+" (its `usePushToTalkGesture` keeps the window-level
 * move/release listeners, and the finger is still on it); this object is only the pipe between the
 * two. It is deliberately tolerant of ordering, because the receiving mic mounts inside a popup that
 * is opened by the very hold it is meant to receive:
 *
 *   - moves reported before the mic claims the hold are not forwarded, but the latest one is kept
 *     (`getLastMove`) so the receiver can apply it once it has started, and a slide that began
 *     early is not forgotten;
 *   - a release that lands before the claim is stored and delivered at claim time, so the mic still
 *     gets exactly one press-start and one press-end and never stays hot without a finger on it;
 *   - a hold can be claimed at most once. A second claimant (a remount, a second input) gets
 *     nothing, which is what keeps one hold from opening the microphone twice.
 *
 * Kept free of React and of the DOM so the contract can be tested as plain function calls.
 */

/**
 * @param {{ origin?: {clientX: number, clientY: number}|null }} [options]
 *   `origin` is where the finger went down. The receiving mic draws its ring around it and measures
 *   slide-to-cancel travel from it — the release reported through `end()` already carries travel
 *   measured from this same point.
 */
export function createPushToTalkHandoff({ origin = null } = {}) {
    let listener = null
    let claimed = false
    let lastMove = null
    let pendingEnd = null
    let ended = false

    return {
        origin: origin ? { clientX: origin.clientX, clientY: origin.clientY } : null,

        /** Whether the hold has already been released (and so needs no further forwarding). */
        isEnded: () => ended,

        /** The most recent travel reported so far, or `null`. */
        getLastMove: () => lastMove,

        /**
         * Take the hold over. Returns a function that stops listening (for unmount), or `null` when
         * the hold was already claimed.
         *
         * @param {{
         *   onMove?: (travel: {dx: number, dy: number, distance: number}) => void,
         *   onEnd: (release: object) => void,
         * }} receiver
         */
        claim(receiver) {
            if (claimed || !receiver) return null
            claimed = true
            listener = receiver
            if (pendingEnd) {
                const release = pendingEnd
                pendingEnd = null
                listener = null
                receiver.onEnd?.(release)
                return () => {}
            }
            return () => {
                if (listener === receiver) listener = null
            }
        },

        move(travel) {
            if (ended) return
            lastMove = travel
            listener?.onMove?.(travel)
        },

        end(release) {
            if (ended) return
            ended = true
            if (listener) {
                const receiver = listener
                listener = null
                receiver.onEnd?.(release)
            } else if (!claimed) {
                pendingEnd = release
            }
        },
    }
}
