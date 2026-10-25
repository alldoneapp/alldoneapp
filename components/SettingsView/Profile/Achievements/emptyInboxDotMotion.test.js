import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, Text } from 'react-native'

import useEmptyInboxDotCelebration, {
    BURST_DURATION_MS,
    CELEBRATION_TOTAL_MS,
    DOT_LAND_MS,
    DOT_START_DELAY_MS,
    DOT_ZOOM_MS,
    SPOTLIGHT_MS,
    STREAK_TICK_DELAY_MS,
    STREAK_TICK_MS,
} from './emptyInboxDotMotion'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, values = {}) => `${key}${values.count != null ? ` ${values.count}` : ''}`,
}))

let celebration = null

function MotionHarness({ runId, currentStreak = 4 }) {
    celebration = useEmptyInboxDotCelebration(runId, currentStreak)
    return <Text>{celebration.celebrating ? 'celebrating' : 'idle'}</Text>
}

const valueOf = animatedValue => animatedValue.__getValue()

describe('useEmptyInboxDotCelebration', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalAnnounce = AccessibilityInfo.announceForAccessibility
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        celebration = null
        jest.useFakeTimers()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        AccessibilityInfo.announceForAccessibility = jest.fn()
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        AccessibilityInfo.announceForAccessibility = originalAnnounce
        process.env.NODE_ENV = originalNodeEnv
    })

    // The motion is inert under jest by convention (`animationsAreDisabled`), so every test that
    // wants the real animated branch has to opt out of it the same way a browser would. Without
    // this the assertions below would pass vacuously against a frozen bundle.
    const enableAnimations = () => {
        process.env.NODE_ENV = 'development'
    }

    const render = async (runId, currentStreak) => {
        let tree
        await act(async () => {
            tree = renderer.create(<MotionHarness runId={runId} currentStreak={currentStreak} />)
        })
        return tree
    }

    it('rests with the dot at full size and nothing celebrating', async () => {
        enableAnimations()
        await render(0)

        expect(celebration.celebrating).toBe(false)
        // Load-bearing: `land` rests at 1 and `zoom` at 0 (which every consumer interpolates to
        // "cell size"), so a cell that never celebrates renders pixel-identical to the plain
        // achieved cell it replaces.
        expect(valueOf(celebration.land)).toBe(1)
        expect(valueOf(celebration.zoom)).toBe(0)
        expect(valueOf(celebration.burst)).toBe(0)
        expect(valueOf(celebration.spotlight)).toBe(0)
        expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled()
    })

    it('plays the run and settles itself on a timer', async () => {
        enableAnimations()
        const tree = await render(0)

        await act(async () => {
            tree.update(<MotionHarness runId={1} currentStreak={4} />)
        })

        expect(celebration.celebrating).toBe(true)
        expect(celebration.animated).toBe(true)
        // The dot starts from nothing: this is the frame the user must see first, and it is why
        // the run is started from a layout effect rather than a passive one.
        expect(valueOf(celebration.land)).toBe(0)

        await act(async () => {
            jest.advanceTimersByTime(CELEBRATION_TOTAL_MS)
        })

        expect(celebration.celebrating).toBe(false)
        expect(valueOf(celebration.land)).toBe(1)
        expect(valueOf(celebration.zoom)).toBe(0)
        expect(valueOf(celebration.burst)).toBe(0)
        expect(valueOf(celebration.spotlight)).toBe(0)
        expect(valueOf(celebration.tick)).toBe(0)
    })

    /**
     * AT-2460 — the dot waits for the congratulation instead of competing with it.
     *
     * The two halves of the celebration used to start on the same frame, several blocks apart on
     * the page, which is a large part of why nobody ever found the dot: it did its whole 760ms
     * while the eye was on the headline.
     *
     * This is asserted on the SCHEDULE rather than on the animated values, and deliberately so.
     * `Animated` is driven by `requestAnimationFrame`, which jest's fake timers do not advance in
     * this setup — every value stays at whatever the hook last `setValue`d it to. A test that read
     * `land` half a second in would therefore report 0 whether the staging was right, wrong or
     * absent, which is precisely the kind of vacuous assertion the sibling suites of this feature
     * exist to warn about. What a real browser does with these durations is covered by the
     * relationships below plus the render-level suites.
     */
    it('stages the dot after the congratulation and the streak after the dot', () => {
        // Nothing in the card moves until the congratulation has had the opening beat to itself.
        expect(DOT_START_DELAY_MS).toBeGreaterThan(0)
        // The card lights up on the same frame the dot starts, so there is something to follow
        // from the headline down to an 11px cell.
        expect(SPOTLIGHT_MS).toBeGreaterThan(DOT_LAND_MS)
        // The swell is the beat that makes the dot findable, so it is the longest of them.
        expect(DOT_ZOOM_MS).toBeGreaterThan(DOT_LAND_MS)
        // The streak number is the consequence of the dot and must not move while the dot still is.
        expect(STREAK_TICK_DELAY_MS).toBe(DOT_START_DELAY_MS + DOT_LAND_MS + DOT_ZOOM_MS)
    })

    it('outlasts every beat it schedules', () => {
        // A settle that lands before the last beat would freeze a half-expanded ring over the grid.
        expect(CELEBRATION_TOTAL_MS).toBeGreaterThan(DOT_START_DELAY_MS + DOT_LAND_MS + DOT_ZOOM_MS)
        expect(CELEBRATION_TOTAL_MS).toBeGreaterThan(DOT_START_DELAY_MS + BURST_DURATION_MS)
        expect(CELEBRATION_TOTAL_MS).toBeGreaterThan(DOT_START_DELAY_MS + SPOTLIGHT_MS)
        expect(CELEBRATION_TOTAL_MS).toBeGreaterThan(STREAK_TICK_DELAY_MS + STREAK_TICK_MS)
        // ...and stays a bounded moment rather than the card being busy. AT-2460 asked for longer,
        // not for open-ended: past a few seconds a daily reward starts to read as something you
        // are waiting for.
        expect(CELEBRATION_TOTAL_MS).toBeLessThan(3500)
    })

    it('announces the new streak to screen readers', async () => {
        enableAnimations()
        const tree = await render(0, 7)

        await act(async () => {
            tree.update(<MotionHarness runId={1} currentStreak={7} />)
        })

        expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Empty inbox streak day added 7')
    })

    it('keeps the information and drops the motion under reduced motion', async () => {
        enableAnimations()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        const tree = await render(0)

        await act(async () => {
            tree.update(<MotionHarness runId={1} currentStreak={4} />)
        })

        expect(celebration.animated).toBe(false)
        // Never enters the celebrating state at all, so no ring, no sparks, no swelling dot, no
        // callout, no card outline, no held-back streak number — the dot is simply already green,
        // which is also what a reload renders.
        expect(celebration.celebrating).toBe(false)
        expect(valueOf(celebration.land)).toBe(1)
        expect(valueOf(celebration.zoom)).toBe(0)
        expect(valueOf(celebration.spotlight)).toBe(0)
        // The announcement is information, not motion, so it still fires.
        expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalled()
    })

    it('is inert under jest without opting out', async () => {
        const tree = await render(0)

        await act(async () => {
            tree.update(<MotionHarness runId={1} currentStreak={4} />)
        })

        expect(celebration.animated).toBe(false)
        expect(celebration.celebrating).toBe(false)
    })

    // `useReducedMotion` resolves from a promise, so the preference can land after a run has
    // already started. That re-enters the effect, and without the settled-run guard it would
    // replay the whole celebration from the top.
    it('never replays a run that has already settled', async () => {
        enableAnimations()
        const tree = await render(0)

        await act(async () => {
            tree.update(<MotionHarness runId={1} currentStreak={4} />)
        })
        await act(async () => {
            jest.advanceTimersByTime(CELEBRATION_TOTAL_MS)
        })
        expect(celebration.celebrating).toBe(false)

        // Same run id, effect re-entered by a dependency change.
        await act(async () => {
            process.env.NODE_ENV = 'test'
            tree.update(<MotionHarness runId={1} currentStreak={4} />)
        })

        expect(celebration.celebrating).toBe(false)
        expect(valueOf(celebration.land)).toBe(1)
    })

    it('stops the animation when the card unmounts mid-run', async () => {
        enableAnimations()
        const tree = await render(0)

        await act(async () => {
            tree.update(<MotionHarness runId={1} currentStreak={4} />)
        })
        expect(celebration.celebrating).toBe(true)

        await act(async () => {
            tree.unmount()
        })

        // The settle timer must not fire into an unmounted tree.
        expect(() => jest.advanceTimersByTime(CELEBRATION_TOTAL_MS)).not.toThrow()
    })
})
