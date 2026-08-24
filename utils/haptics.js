/**
 * Vibration feedback, for gestures whose state changes while the user is looking somewhere else.
 *
 * Introduced for the dictation hold overlay (AT-2408): crossing into and out of the slide-to-cancel
 * state is the one moment where a buzz carries information the screen cannot, because the thumb is
 * on top of the control and the eyes are usually on the text, not the ring.
 *
 * Deliberately fire-and-forget and deliberately silent about being unsupported. `navigator.vibrate`
 * does not exist on iOS Safari at all and is ignored by browsers that require a prior user gesture
 * they did not see; none of that is worth a branch at the call site, and a missing buzz never
 * changes what the app does. Callers must treat haptics as decoration on top of a visual change
 * that already stands on its own.
 */

export const HAPTIC_CANCEL_ARMED_MS = 30
export const HAPTIC_CANCEL_DISARMED_MS = 12

/**
 * @param {number|number[]} pattern milliseconds, or an on/off pattern
 * @returns {boolean} whether the browser accepted the request (for tests; never branch on it)
 */
export function vibrate(pattern) {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
    try {
        return !!navigator.vibrate(pattern)
    } catch (error) {
        // Some browsers throw instead of returning false when vibration is disallowed.
        return false
    }
}
