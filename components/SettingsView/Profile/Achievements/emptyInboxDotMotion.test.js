import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, Text } from 'react-native'

import useEmptyInboxDotCelebration, {
    BURST_DURATION_MS,
    CELEBRATION_TOTAL_MS,
    DOT_LAND_MS,
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
        // Load-bearing: `land` rests at 1 so a cell that never celebrates renders pixel-identical
        // to the plain achieved cell it replaces.
        expect(valueOf(celebration.land)).toBe(1)
        expect(valueOf(celebration.burst)).toBe(0)
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
        expect(valueOf(celebration.burst)).toBe(0)
        expect(valueOf(celebration.tick)).toBe(0)
    })

    it('outlasts every beat it schedules', () => {
        // A settle that lands before the last beat would freeze a half-expanded ring over the grid.
        expect(CELEBRATION_TOTAL_MS).toBeGreaterThan(DOT_LAND_MS)
        expect(CELEBRATION_TOTAL_MS).toBeGreaterThan(BURST_DURATION_MS)
        expect(CELEBRATION_TOTAL_MS).toBeGreaterThan(STREAK_TICK_DELAY_MS + STREAK_TICK_MS)
        // ...and stays short enough to read as a reward rather than as the card being busy.
        expect(CELEBRATION_TOTAL_MS).toBeLessThan(1000)
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
        // Never enters the celebrating state at all, so no ring, no sparks, no held-back streak
        // number — the dot is simply already green, which is also what a reload renders.
        expect(celebration.celebrating).toBe(false)
        expect(valueOf(celebration.land)).toBe(1)
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
