/**
 * AT-2495 — playing the row's completion animation from OUTSIDE the row.
 *
 * AT-2404 put the completion motion where it belongs: `useTaskCompletionMotion` is owned by
 * `TaskPresentation` (the row) and triggered by `CheckBoxWrapper` (the checkbox inside it) through
 * a `beginCompletionMotion` prop. That covers ticking the checkbox and nothing else — and ticking
 * the checkbox is NOT the only way a task is completed from a row.
 *
 * Press and hold the same checkbox and a popup opens (`TaskFlowModal` → `WorkflowModal`,
 * `FollowUpModal`, `SuggestedModal`), and pressing "Done" there writes straight to Firestore. Those
 * modals live several levels below the row and had no access to its motion, so the task simply
 * blinked out of the list with no animation at all. They dispatched the pre-AT-2404
 * `showTaskCompletionAnimation()` instead — the full-screen random Giphy overlay — which had in
 * fact been inert for a long time: the action creator carried no payload and the reducer assigned
 * `action.showTaskCompletionAnimation` (i.e. `undefined`) to the flag the overlay was gated on. So
 * the popup path was showing nothing, exactly as reported.
 *
 * This module is the one place that knows how to borrow the row's animation from a component that
 * is not the row. It exists rather than repeating four lines at each call site because the ORDER
 * matters and is easy to get subtly wrong:
 *
 *   1. The popup closes first. The popover is anchored to the checkbox and `popoverToSafePosition`
 *      centres it on mobile, so a popup still on screen covers the very row it is animating.
 *   2. The motion begins, and it answers with how long the caller must wait.
 *   3. The write is held for that long. Not for cosmetics: a completing row collapses to zero
 *      height, and the Firestore snapshot that drops the task from the list must not land while the
 *      row is still mid-animation — that is the same reason `CheckBoxWrapper` holds its own write.
 *   4. If the write fails, the motion is cancelled so the collapsed row comes back instead of
 *      being left behind as an invisible zero-height gap.
 *
 * Two details that a hand-rolled `setTimeout` at each call site would get wrong:
 *
 *   • The hold is measured from the moment the motion STARTED, not from the moment the caller is
 *     ready to write. Every one of these modals does asynchronous work first
 *     (`updateNewAttachmentsData` uploads whatever the user attached to the completion comment).
 *     Counting that work against the hold means an upload that already outlasted the animation adds
 *     no further delay, while a plain "Done" with nothing attached still waits out the full run.
 *   • With no motion available the run is INERT: `settled()` resolves immediately and the write
 *     goes out exactly as it does today. That is not a defensive nicety, it is a real surface —
 *     `TaskChatWorkflowControls` renders the same workflow controls in the task detailed view,
 *     where there is no row to animate.
 */

const INERT_RUN = {
    settled: () => Promise.resolve(),
    cancel: () => {},
}

/**
 * @param {?{begin: function, cancel: function}} completionMotion The handoff returned by
 *   `useTaskCompletionMotion`, threaded down from the row. Absent on surfaces that render no row.
 * @param {object} [options]
 * @param {boolean} [options.isCompletion=true] Whether the task is genuinely being COMPLETED.
 *   False when a workflow task is merely handed to the next reviewer: the row still leaves the
 *   list and still gets the exit, but it must not be swept to 100%, tinted green or celebrated at
 *   the checkbox — it would be congratulated for finishing something it has only passed on. Same
 *   flag, same meaning, as the one `CheckBoxWrapper` passes.
 * @returns {{settled: function(): Promise<void>, cancel: function(): void}}
 */
export const startTaskCompletionMotion = (completionMotion, { isCompletion = true } = {}) => {
    const begin = completionMotion?.begin
    if (typeof begin !== 'function') return INERT_RUN

    const holdMs = begin({ isCompletion })
    const startedAt = Date.now()
    let cancelled = false

    return {
        settled: () => {
            const remaining = (typeof holdMs === 'number' ? holdMs : 0) - (Date.now() - startedAt)
            if (!(remaining > 0)) return Promise.resolve()
            return new Promise(resolve => setTimeout(resolve, remaining))
        },
        cancel: () => {
            // Idempotent: several call sites cancel from both a `catch` and a `finally`-ish guard,
            // and resetting a row twice would restart the reset animation from a clean state.
            if (cancelled) return
            cancelled = true
            const cancelMotion = completionMotion?.cancel
            if (typeof cancelMotion === 'function') cancelMotion()
        },
    }
}

/**
 * Convenience wrapper for the common shape: animate, wait, write, and put the row back if the write
 * fails. `write` is invoked once, only after the animation has had its run.
 *
 * Rethrows whatever `write` rejects with, so each caller keeps its own error reporting (the modals
 * differ: one alerts, one re-enables its buttons, one only logs).
 */
export const completeTaskWithMotion = async (completionMotion, options, write) => {
    const run = startTaskCompletionMotion(completionMotion, options)
    try {
        await run.settled()
        return await write()
    } catch (error) {
        run.cancel()
        throw error
    }
}
