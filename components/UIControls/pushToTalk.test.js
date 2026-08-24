/**
 * The push-to-talk state table (AT-2405).
 *
 * The load-bearing property is that adding hold-to-send did not take tap-to-toggle away: both
 * gestures start the same recording on press-down, and only the release tells them apart. Every
 * "keep-recording" outcome below is the legacy behaviour arriving by the new route, so a
 * regression here is a regression in a feature that shipped long before this one.
 */
import {
    PUSH_TO_TALK_CANCEL_DEAD_ZONE,
    PUSH_TO_TALK_CANCEL_RADIUS,
    PUSH_TO_TALK_DISCARD,
    PUSH_TO_TALK_HOLD_MS,
    PUSH_TO_TALK_KEEP_RECORDING,
    PUSH_TO_TALK_STOP,
    PUSH_TO_TALK_SUBMIT,
    isCancelArmed,
    isReleaseInsideRect,
    resolveCancelProgress,
    resolvePushToTalkRelease,
} from './pushToTalk'

const release = overrides =>
    resolvePushToTalkRelease({
        heldMs: 1200,
        releasedInside: true,
        cancelled: false,
        pressStartedRecording: true,
        ...overrides,
    })

describe('resolvePushToTalkRelease', () => {
    describe('a press that started the recording', () => {
        test('held past the threshold and released on the button submits', () => {
            expect(release({ heldMs: PUSH_TO_TALK_HOLD_MS })).toBe(PUSH_TO_TALK_SUBMIT)
        })

        test('a quick tap leaves the recording running — the legacy toggle', () => {
            expect(release({ heldMs: PUSH_TO_TALK_HOLD_MS - 1 })).toBe(PUSH_TO_TALK_KEEP_RECORDING)
            expect(release({ heldMs: 0 })).toBe(PUSH_TO_TALK_KEEP_RECORDING)
        })

        test('sliding off the button before letting go discards the take', () => {
            expect(release({ releasedInside: false })).toBe(PUSH_TO_TALK_DISCARD)
        })

        test('a tap that ends off the button still just leaves the recording running', () => {
            // Below the threshold the press was never a hold, so "slide to cancel" cannot apply —
            // otherwise a slightly sloppy tap would silently throw the recording away.
            expect(release({ heldMs: 50, releasedInside: false })).toBe(PUSH_TO_TALK_KEEP_RECORDING)
        })

        test('a gesture the browser cancels ends the take rather than leaving the mic hot', () => {
            expect(release({ cancelled: true, releasedInside: true })).toBe(PUSH_TO_TALK_DISCARD)
            expect(release({ cancelled: true, heldMs: 10 })).toBe(PUSH_TO_TALK_DISCARD)
        })
    })

    describe('a press on an already-running recording (the second tap of the toggle)', () => {
        const onRunning = overrides => release({ pressStartedRecording: false, ...overrides })

        test('stops without submitting, however long it was held', () => {
            expect(onRunning({ heldMs: 30 })).toBe(PUSH_TO_TALK_STOP)
            // Holding the button on a take that was started by an earlier tap must NOT submit:
            // the user chose the toggle, so they own the send button too.
            expect(onRunning({ heldMs: 5000 })).toBe(PUSH_TO_TALK_STOP)
        })

        test('releasing outside leaves the recording alone', () => {
            expect(onRunning({ releasedInside: false })).toBe(PUSH_TO_TALK_KEEP_RECORDING)
        })

        test('a cancelled gesture leaves the recording alone', () => {
            expect(onRunning({ cancelled: true })).toBe(PUSH_TO_TALK_KEEP_RECORDING)
        })
    })

    test('the threshold is configurable but defaults to the shared constant', () => {
        expect(release({ heldMs: 300, holdThresholdMs: 200 })).toBe(PUSH_TO_TALK_SUBMIT)
        expect(release({ heldMs: 300 })).toBe(PUSH_TO_TALK_KEEP_RECORDING)
    })
})

/**
 * Slide-to-cancel by distance (AT-2408).
 *
 * The rule this replaces discarded the take whenever the release landed off a 24px button — under a
 * thumb roughly twice that wide, with nothing drawn on screen to say so. Losing a spoken sentence
 * was therefore both the easiest outcome to reach and the only one with no explanation. These tests
 * pin the two halves of the fix: drifting is now forgiven, and the distance that is NOT forgiven is
 * the same number the ring is drawn at.
 */
describe('slide-to-cancel distance (AT-2408)', () => {
    test('progress is zero inside the dead zone, one at the ring, and rises in between', () => {
        expect(resolveCancelProgress(0)).toBe(0)
        expect(resolveCancelProgress(PUSH_TO_TALK_CANCEL_DEAD_ZONE)).toBe(0)
        expect(resolveCancelProgress(PUSH_TO_TALK_CANCEL_RADIUS)).toBe(1)
        expect(resolveCancelProgress(PUSH_TO_TALK_CANCEL_RADIUS + 500)).toBe(1)

        const midpoint = (PUSH_TO_TALK_CANCEL_DEAD_ZONE + PUSH_TO_TALK_CANCEL_RADIUS) / 2
        expect(resolveCancelProgress(midpoint)).toBeCloseTo(0.5, 5)
    })

    test('progress never reports motion for an unmeasurable distance', () => {
        // A finger resting on glass jitters; a ring that shimmers while the user holds still reads
        // as broken, and NaN reaching an Animated.Value would freeze the whole overlay.
        expect(resolveCancelProgress(undefined)).toBe(0)
        expect(resolveCancelProgress(NaN)).toBe(0)
        expect(resolveCancelProgress(-40)).toBe(0)
    })

    test('the ring radius IS the arming distance — the drawn boundary cannot lie', () => {
        expect(isCancelArmed(PUSH_TO_TALK_CANCEL_RADIUS - 1)).toBe(false)
        expect(isCancelArmed(PUSH_TO_TALK_CANCEL_RADIUS)).toBe(true)
        expect(isCancelArmed(undefined)).toBe(false)
    })

    test('a hold released well beyond the ring is discarded', () => {
        expect(release({ distance: PUSH_TO_TALK_CANCEL_RADIUS + 20, releasedInside: false })).toBe(PUSH_TO_TALK_DISCARD)
    })

    test('drifting off the button but staying inside the ring still SUBMITS', () => {
        // The whole bug: 40px of thumb travel used to be indistinguishable from a deliberate cancel.
        expect(release({ distance: 40, releasedInside: false })).toBe(PUSH_TO_TALK_SUBMIT)
        expect(release({ distance: PUSH_TO_TALK_CANCEL_RADIUS - 1, releasedInside: false })).toBe(PUSH_TO_TALK_SUBMIT)
    })

    test('a fast flick out of the ring cancels even though it was too short to be a hold', () => {
        // Once a ring is on screen promising that sliding out cancels, it has to cancel at any
        // speed — otherwise the mic is left hot right after the user performed the cancel gesture.
        expect(release({ heldMs: 80, distance: PUSH_TO_TALK_CANCEL_RADIUS + 60 })).toBe(PUSH_TO_TALK_DISCARD)
    })

    test('a quick tap that barely moves is still the legacy toggle', () => {
        expect(release({ heldMs: 80, distance: 6 })).toBe(PUSH_TO_TALK_KEEP_RECORDING)
    })

    test('the radius is configurable, and defaults to the constant the ring reads', () => {
        expect(release({ distance: 50, cancelRadius: 40 })).toBe(PUSH_TO_TALK_DISCARD)
        expect(release({ distance: 50 })).toBe(PUSH_TO_TALK_SUBMIT)
    })

    test('a caller that cannot measure travel keeps the pre-AT-2408 rule exactly', () => {
        // Ordering matters as much as the rule: the fallback sits AFTER the hold threshold, which is
        // what kept a sloppy tap from discarding a take before this change and must keep doing so.
        expect(release({ distance: undefined, releasedInside: false })).toBe(PUSH_TO_TALK_DISCARD)
        expect(release({ distance: undefined, heldMs: 50, releasedInside: false })).toBe(PUSH_TO_TALK_KEEP_RECORDING)
    })

    test('travel never overrides a cancelled gesture or the toggle branch', () => {
        expect(release({ cancelled: true, distance: 0 })).toBe(PUSH_TO_TALK_DISCARD)
        // A press on an already-running take: sliding away does not cancel, because that press did
        // not start the recording. The overlay is not drawn for it either — see RambleButton.
        expect(release({ pressStartedRecording: false, distance: 400, releasedInside: false })).toBe(
            PUSH_TO_TALK_KEEP_RECORDING
        )
    })
})

describe('isReleaseInsideRect', () => {
    const rect = { left: 10, right: 40, top: 100, bottom: 130, width: 30, height: 30 }

    test('a release over the button is inside, one beside it is not', () => {
        expect(isReleaseInsideRect(rect, { clientX: 20, clientY: 110 })).toBe(true)
        expect(isReleaseInsideRect(rect, { clientX: 60, clientY: 110 })).toBe(false)
        expect(isReleaseInsideRect(rect, { clientX: 20, clientY: 200 })).toBe(false)
    })

    test('the edges count as inside', () => {
        expect(isReleaseInsideRect(rect, { clientX: 10, clientY: 100 })).toBe(true)
        expect(isReleaseInsideRect(rect, { clientX: 40, clientY: 130 })).toBe(true)
    })

    test('an unmeasurable rect counts as inside rather than cancelling every hold', () => {
        // jsdom reports 0x0 for everything, and a detached node does too. Defaulting the other way
        // would make every hold a cancel wherever layout is unavailable.
        expect(
            isReleaseInsideRect(
                { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 },
                { clientX: 5, clientY: 5 }
            )
        ).toBe(true)
    })

    test('a missing rect or point is not inside', () => {
        expect(isReleaseInsideRect(null, { clientX: 1, clientY: 1 })).toBe(false)
        expect(isReleaseInsideRect(rect, null)).toBe(false)
        expect(isReleaseInsideRect(rect, {})).toBe(false)
    })
})
