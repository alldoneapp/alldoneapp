/**
 * Push-to-talk decision logic for the dictation mic (AT-2405).
 *
 * The mic has always been a toggle: tap to start, tap again to stop, transcript inserted at the
 * caret, and the user submits by hand. Push-to-talk adds the other half — hold the mic, speak,
 * release, and the transcript is inserted AND submitted — without taking the toggle away, because
 * a long dictation into a note or a task description is still a tap-and-talk job and holding a
 * button for two minutes is not a feature.
 *
 * Both gestures therefore start the SAME recording on press-down. That is the important part and
 * the reason this module exists rather than an `onLongPress` handler: a recording that only starts
 * once the hold threshold has elapsed loses the first ~400ms of speech, which in practice is the
 * first word. So we always start immediately and decide what the press MEANT on release, from how
 * long it was held. A quick tap simply leaves the recording running, which is exactly the legacy
 * behaviour; nothing about the toggle path changed.
 *
 * Kept pure and separate from the DOM wiring (`hooks/usePushToTalkGesture.js`) and from the
 * recorder so the state table can be tested as a table, which is what it is.
 */

/**
 * Below this, a press is a tap and the recording keeps running until the next tap. Above it, the
 * press is a hold and releasing ends the take. 400ms is comfortably above an intentional tap
 * (~80-150ms) and below the point where a user holding the button expects something to happen.
 */
export const PUSH_TO_TALK_HOLD_MS = 400

/**
 * A hold that captured less than this much audio is thrown away instead of submitted. Auto-submit
 * means the result goes straight into a chat with no review step, so the cost of a misfire is a
 * junk message someone else reads — the cost of a false discard is one repeated sentence. Note
 * this is measured against how long the RECORDER ran, not how long the button was held: `start()`
 * is async (permission gate + the AT-2357 silence probe), so a 500ms hold can easily contain zero
 * audio, and that case must discard rather than upload an empty clip and bill Gold for it.
 */
export const PUSH_TO_TALK_MIN_RECORDING_MS = 1000

export const PUSH_TO_TALK_KEEP_RECORDING = 'keep-recording'
export const PUSH_TO_TALK_SUBMIT = 'submit'
export const PUSH_TO_TALK_STOP = 'stop'
export const PUSH_TO_TALK_DISCARD = 'discard'

/**
 * What a released press means.
 *
 * Note this deliberately does NOT apply `PUSH_TO_TALK_MIN_RECORDING_MS`. How much audio exists is
 * not knowable from the press: `start()` is async, so a 700ms hold can contain 700ms of speech or
 * none at all depending on how long the permission gate and the silence probe took. Only the
 * recorder knows when capture actually began, so it owns that guard (`stop({minDurationMs})`) and
 * reports back whether the take survived.
 *
 * @param {{
 *   heldMs: number,             // press-down to release
 *   releasedInside: boolean,    // was the pointer still over the button at release
 *   cancelled?: boolean,        // the browser took the gesture away (scroll, pointercancel)
 *   pressStartedRecording: boolean, // did THIS press start the recording, or was one already running
 *   holdThresholdMs?: number,
 * }} press
 * @returns {'keep-recording'|'submit'|'stop'|'discard'}
 */
export function resolvePushToTalkRelease({
    heldMs,
    releasedInside,
    cancelled = false,
    pressStartedRecording,
    holdThresholdMs = PUSH_TO_TALK_HOLD_MS,
}) {
    // A press that landed on an ALREADY-RUNNING recording is the second tap of the toggle. It can
    // never submit: the user started that take by tapping, so they own the send button too, and
    // silently posting a take they started a minute ago would be the opposite of push-to-talk.
    if (!pressStartedRecording) {
        if (cancelled) return PUSH_TO_TALK_KEEP_RECORDING
        return releasedInside ? PUSH_TO_TALK_STOP : PUSH_TO_TALK_KEEP_RECORDING
    }

    // The browser took the gesture away mid-press — a scroll started under the finger, or the tab
    // lost the pointer. Leaving the mic hot while the user is scrolling somewhere else is the
    // worst outcome available, so a cancelled press always ends the take it started.
    if (cancelled) return PUSH_TO_TALK_DISCARD

    // Short press: a tap. The recording this press started keeps running, and the next tap stops
    // it. This is the pre-existing behaviour, reached by a different route.
    if (heldMs < holdThresholdMs) return PUSH_TO_TALK_KEEP_RECORDING

    // Slide-off-to-cancel: the finger left the button before letting go. The whole take is dropped
    // — nothing is uploaded, nothing is transcribed, no Gold is spent.
    if (!releasedInside) return PUSH_TO_TALK_DISCARD

    return PUSH_TO_TALK_SUBMIT
}

/**
 * Whether a release position counts as "on the button". Uses the live rect so a button that moved
 * during the press (the mic grows into a timer chip while recording) is judged where it ended up,
 * not where it started.
 */
export function isReleaseInsideRect(rect, point) {
    if (!rect || !point || point.clientX == null || point.clientY == null) return false
    // A zero-size rect means we could not measure (detached node, jsdom without layout). Treat it
    // as inside: failing to measure must not silently turn every hold into a cancel.
    if (!rect.width && !rect.height) return true
    return (
        point.clientX >= rect.left &&
        point.clientX <= rect.right &&
        point.clientY >= rect.top &&
        point.clientY <= rect.bottom
    )
}
