/**
 * @jest-environment jsdom
 *
 * Vibration feedback (AT-2408).
 *
 * The only property that matters here is that it can never take anything down. It is called from
 * inside a pointer-move handler during a live recording, and the browsers that do not support it
 * are the ones this feature is most used on — an iPhone has no `navigator.vibrate` at all, and
 * several browsers throw rather than returning false when vibration is disallowed. A missing buzz
 * is nothing; a thrown error there would abort the gesture mid-hold.
 */
import { HAPTIC_CANCEL_ARMED_MS, HAPTIC_CANCEL_DISARMED_MS, vibrate } from './haptics'

const originalVibrate = navigator.vibrate

afterEach(() => {
    if (originalVibrate === undefined) delete navigator.vibrate
    else navigator.vibrate = originalVibrate
})

describe('vibrate', () => {
    test('passes the pattern straight through when the browser supports it', () => {
        const spy = jest.fn(() => true)
        navigator.vibrate = spy

        expect(vibrate(HAPTIC_CANCEL_ARMED_MS)).toBe(true)
        expect(spy).toHaveBeenCalledWith(HAPTIC_CANCEL_ARMED_MS)
    })

    test('is a no-op where the API does not exist (every iOS browser)', () => {
        delete navigator.vibrate

        expect(() => vibrate(HAPTIC_CANCEL_DISARMED_MS)).not.toThrow()
        expect(vibrate(HAPTIC_CANCEL_DISARMED_MS)).toBe(false)
    })

    test('a browser that throws instead of refusing is swallowed', () => {
        navigator.vibrate = () => {
            throw new Error('vibration blocked by permissions policy')
        }

        expect(vibrate(30)).toBe(false)
    })

    test('a refusal is reported without being an error', () => {
        navigator.vibrate = () => false

        expect(vibrate(30)).toBe(false)
    })

    test('the two cancel buzzes are distinguishable, and both are short', () => {
        // Leaving the ring is the more consequential edge, so it is the stronger buzz; both stay
        // well under the threshold where a vibration reads as an alarm rather than as a tick.
        expect(HAPTIC_CANCEL_ARMED_MS).toBeGreaterThan(HAPTIC_CANCEL_DISARMED_MS)
        expect(HAPTIC_CANCEL_ARMED_MS).toBeLessThanOrEqual(50)
    })
})
