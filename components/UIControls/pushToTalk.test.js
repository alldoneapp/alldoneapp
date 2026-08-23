/**
 * The push-to-talk state table (AT-2405).
 *
 * The load-bearing property is that adding hold-to-send did not take tap-to-toggle away: both
 * gestures start the same recording on press-down, and only the release tells them apart. Every
 * "keep-recording" outcome below is the legacy behaviour arriving by the new route, so a
 * regression here is a regression in a feature that shipped long before this one.
 */
import {
    PUSH_TO_TALK_DISCARD,
    PUSH_TO_TALK_HOLD_MS,
    PUSH_TO_TALK_KEEP_RECORDING,
    PUSH_TO_TALK_STOP,
    PUSH_TO_TALK_SUBMIT,
    isReleaseInsideRect,
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
