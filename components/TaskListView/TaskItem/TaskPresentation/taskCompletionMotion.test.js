import React from 'react'
import { AccessibilityInfo, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import useTaskCompletionMotion, {
    COMPLETION_HOLD_MS,
    COLLAPSE_DURATION_MS,
    COLLAPSE_DELAY_MS,
    REDUCED_MOTION_HOLD_MS,
    STRIKE_DURATION_MS,
} from './taskCompletionMotion'

/**
 * AT-2404. The hook decides two things nothing else can see: how long the checkbox must hold its
 * Firestore write, and whether the row is allowed to move at all. Both are asserted directly here
 * because a broken hold is invisible in the UI — the task still completes, it just completes over
 * the wrong animation, or (worse) writes while the row is still mid-collapse.
 */

let motion
const Harness = () => {
    motion = useTaskCompletionMotion()
    return <View />
}

const layout = height => ({ nativeEvent: { layout: { height } } })

const renderHarness = async () => {
    let tree
    await act(async () => {
        tree = renderer.create(<Harness />)
        await Promise.resolve()
    })
    return tree
}

describe('useTaskCompletionMotion', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        motion = null
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
    })

    afterEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    // The motion is inert under jest by convention (`animationsAreDisabled`), so every test that
    // wants the real animated branch has to opt out of it the same way a browser would.
    const enableAnimations = () => {
        process.env.NODE_ENV = 'development'
    }

    it('mounts a row with no completion state and no forced height', async () => {
        await renderHarness()

        expect(motion.isCompleting).toBe(false)
        expect(motion.completionStrike).toBeNull()
        // Load-bearing: an ordinary row must never carry a height from a stale measurement.
        expect(motion.rowStyle).toBeUndefined()
    })

    it('runs the full animation and holds the write until after the row has collapsed', async () => {
        enableAnimations()
        await renderHarness()

        act(() => motion.onRowLayout(layout(48)))

        let holdMs
        await act(async () => {
            holdMs = motion.beginCompletionMotion({ strikeThrough: true })
        })

        expect(holdMs).toBe(COMPLETION_HOLD_MS)
        // The write must land after the row is already flat and invisible, never during the
        // collapse — otherwise the snapshot can unmount the row mid-animation.
        expect(COLLAPSE_DELAY_MS + COLLAPSE_DURATION_MS).toBeLessThan(holdMs)
        expect(motion.isCompleting).toBe(true)
        expect(motion.rowStyle).toEqual(expect.objectContaining({ overflow: 'hidden' }))
    })

    it('crosses out a completion but not a workflow step advance', async () => {
        enableAnimations()
        await renderHarness()

        await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))
        expect(motion.completionStrike).not.toBeNull()

        await act(async () => motion.cancelCompletionMotion())
        // A workflow task handed to the next reviewer leaves the list, so it still animates out,
        // but it is not done and must not be shown crossed out or tinted with the success colour.
        await act(async () => motion.beginCompletionMotion({ strikeThrough: false }))
        expect(motion.completionStrike).toBeNull()
        expect(motion.isCompleting).toBe(true)
    })

    it('still strikes and fades a row that has never reported a height', async () => {
        enableAnimations()
        await renderHarness()

        // No onRowLayout at all. Collapsing from an unknown height would jump, so it is skipped —
        // but the completion must not silently do nothing.
        await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))

        expect(motion.completionStrike).not.toBeNull()
        expect(motion.rowStyle).toBeUndefined()
    })

    it('shows a static strike-through and a shorter hold under prefers-reduced-motion', async () => {
        enableAnimations()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        await renderHarness()

        act(() => motion.onRowLayout(layout(48)))

        let holdMs
        await act(async () => {
            holdMs = motion.beginCompletionMotion({ strikeThrough: true })
        })

        expect(holdMs).toBe(REDUCED_MOTION_HOLD_MS)
        expect(holdMs).toBeLessThan(COMPLETION_HOLD_MS)
        // The information survives without the motion: the line is there, fully drawn, immediately.
        expect(motion.completionStrike).toEqual(expect.objectContaining({ animated: false }))
        expect(motion.completionStrike.progress.__getValue()).toBe(1)
        // And the row never collapses, so nothing about its height moves.
        expect(motion.rowStyle).toBeUndefined()
    })

    it('is inert under jest without any component having to advance timers', async () => {
        await renderHarness()

        act(() => motion.onRowLayout(layout(48)))

        let holdMs
        await act(async () => {
            holdMs = motion.beginCompletionMotion({ strikeThrough: true })
        })

        expect(holdMs).toBe(REDUCED_MOTION_HOLD_MS)
        expect(motion.completionStrike.progress.__getValue()).toBe(1)
        expect(motion.rowStyle).toBeUndefined()
    })

    it('restores the row when a failed write cancels the motion', async () => {
        enableAnimations()
        await renderHarness()

        act(() => motion.onRowLayout(layout(48)))
        await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))
        expect(motion.rowStyle).toBeDefined()

        await act(async () => motion.cancelCompletionMotion())

        // Everything back to a normal row — the failure path must not leave an invisible,
        // zero-height row sitting in the list.
        expect(motion.isCompleting).toBe(false)
        expect(motion.completionStrike).toBeNull()
        expect(motion.rowStyle).toBeUndefined()
    })

    it('keeps the strike inside the hold so the line is fully drawn before the row goes', async () => {
        expect(STRIKE_DURATION_MS).toBeLessThanOrEqual(COMPLETION_HOLD_MS)
        expect(STRIKE_DURATION_MS).toBeLessThanOrEqual(COLLAPSE_DELAY_MS)
    })
})
