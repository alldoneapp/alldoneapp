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

/**
 * How far the finger has to travel from where it pressed before the take is thrown away (AT-2408).
 *
 * This replaces "released outside the button" as the cancel rule, and the change is the whole
 * point. The mic is a 24px target under a thumb roughly twice that wide, so the old rule fired on a
 * few pixels of drift — invisibly, because nothing was drawn and nothing moved. Silently discarding
 * a sentence someone just spoke is the worst outcome this feature has, and it was the EASIEST one
 * to reach.
 *
 * 96px is deliberately larger than a thumb: it cannot be crossed by holding still, and the ring
 * drawn at exactly this radius (`RambleHoldOverlay`) is the promise that the boundary is where the
 * user can see it. The two must stay in step — the ring reads the constant, it does not repeat it.
 */
export const PUSH_TO_TALK_CANCEL_RADIUS = 96

/**
 * Travel below this reports zero cancel progress. A finger resting on a screen jitters by a few
 * pixels, and a ring that shimmers while the user holds perfectly still reads as broken.
 */
export const PUSH_TO_TALK_CANCEL_DEAD_ZONE = 16

export const PUSH_TO_TALK_KEEP_RECORDING = 'keep-recording'
export const PUSH_TO_TALK_SUBMIT = 'submit'
export const PUSH_TO_TALK_STOP = 'stop'
export const PUSH_TO_TALK_DISCARD = 'discard'

/**
 * How far into the cancel gesture the finger is, 0..1, for the overlay to animate against.
 *
 * Pure and exported so the visuals and the decision below can never disagree about where the
 * boundary is: 1 means "let go now and it is gone", and it is reached at exactly the radius
 * `isCancelArmed` uses.
 */
export function resolveCancelProgress(
    distance,
    { radius = PUSH_TO_TALK_CANCEL_RADIUS, deadZone = PUSH_TO_TALK_CANCEL_DEAD_ZONE } = {}
) {
    if (!Number.isFinite(distance) || distance <= deadZone) return 0
    if (distance >= radius) return 1
    return (distance - deadZone) / (radius - deadZone)
}

/**
 * Whether releasing right now would discard the take.
 */
export function isCancelArmed(distance, { radius = PUSH_TO_TALK_CANCEL_RADIUS } = {}) {
    return Number.isFinite(distance) && distance >= radius
}

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
 *   distance?: number,          // how far the finger travelled from where it pressed
 *   cancelled?: boolean,        // the browser took the gesture away (scroll, pointercancel)
 *   pressStartedRecording: boolean, // did THIS press start the recording, or was one already running
 *   holdThresholdMs?: number,
 *   cancelRadius?: number,
 * }} press
 * @returns {'keep-recording'|'submit'|'stop'|'discard'}
 */
export function resolvePushToTalkRelease({
    heldMs,
    releasedInside,
    distance,
    cancelled = false,
    pressStartedRecording,
    holdThresholdMs = PUSH_TO_TALK_HOLD_MS,
    cancelRadius = PUSH_TO_TALK_CANCEL_RADIUS,
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

    // Slide-to-cancel: the finger travelled out of the ring drawn around the press point (AT-2408).
    // The whole take is dropped — nothing is uploaded, nothing is transcribed, no Gold is spent.
    //
    // Measured travel is checked BEFORE the hold threshold on purpose. Once a ring is on screen
    // promising that sliding out of it cancels, a FAST flick out has to cancel too; the alternative
    // is a mic left hot after the user visibly performed the cancel gesture, just quickly. That is
    // safe to do here precisely because 96px is a deliberate movement — the old "left the 24px
    // button" test could never have been trusted this way, which is why it stayed below the
    // threshold and why a sloppy tap used to be the only thing it protected.
    const measuredTravel = distance != null
    if (measuredTravel && isCancelArmed(distance, { radius: cancelRadius })) return PUSH_TO_TALK_DISCARD

    // Short press: a tap. The recording this press started keeps running, and the next tap stops
    // it. This is the pre-existing behaviour, reached by a different route.
    if (heldMs < holdThresholdMs) return PUSH_TO_TALK_KEEP_RECORDING

    // Fallback for a caller that cannot measure travel at all (no coordinates on the event). Keeps
    // the pre-AT-2408 rule and its exact position in the order, so nothing that used to work
    // changes shape just because a synthetic release carries no point.
    if (!measuredTravel && !releasedInside) return PUSH_TO_TALK_DISCARD

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
