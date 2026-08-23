import React from 'react'
import { AccessibilityInfo, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import useTaskCompletionMotion, {
    BURST_DURATION_MS,
    COLLAPSE_DELAY_MS,
    COLLAPSE_DURATION_MS,
    COMPLETION_HOLD_MS,
    FLOURISH_FADE_IN_MS,
    REDUCED_MOTION_HOLD_MS,
    REDUCED_MOTION_RELEASE_MS,
    RELEASE_DELAY_MS,
    RELEASE_DURATION_MS,
    RETAINED_HOLD_MS,
    STRIKE_DELAY_MS,
    STRIKE_DURATION_MS,
    rowRemainsAfterCompletion,
} from './taskCompletionMotion'

/**
 * AT-2404. The hook decides three things nothing else can see: how long the checkbox must hold its
 * Firestore write, whether the row is allowed to move at all, and — the one this pass exists for —
 * whether the row is allowed to COLLAPSE. All three are asserted directly, because each is
 * invisible in the UI when it goes wrong: the task still completes, it just completes over the
 * wrong animation, writes while the row is still mid-collapse, or (the subtask bug) leaves an
 * invisible zero-height row sitting in a list that never removes it.
 */

let motion
const Harness = ({ options }) => {
    motion = useTaskCompletionMotion(options)
    return <View />
}

const layout = height => ({ nativeEvent: { layout: { height } } })

const renderHarness = async (options = {}) => {
    let tree
    await act(async () => {
        tree = renderer.create(<Harness options={options} />)
        await Promise.resolve()
    })
    return tree
}

describe('rowRemainsAfterCompletion', () => {
    /**
     * The single rule behind the whole subtask guarantee, kept pure so every shape a subtask can
     * arrive in is covered here rather than through a rendered tree.
     */
    it.each([
        ['a subtask flagged by mapTaskData', { isSubtask: true, parentId: 'parent-1' }],
        ['a subtask carrying only the flag', { isSubtask: true }],
        // Legacy/partial documents: `DragHelper` derives `isSubtask` from `parentId`, so a row that
        // has a parent is a child row whatever the flag happens to say.
        ['a subtask carrying only a parent id', { parentId: 'parent-1' }],
    ])('keeps %s on screen', (_description, task) => {
        expect(rowRemainsAfterCompletion(task)).toBe(true)
    })

    it('keeps the comment popup header on screen', () => {
        // A task row rendered inside a modal has no list to leave.
        expect(rowRemainsAfterCompletion({ isSubtask: false }, { inCommentPopup: true })).toBe(true)
    })

    it.each([
        ['an ordinary open task', { isSubtask: false, parentId: null }],
        ['a task with no subtask fields at all', {}],
    ])('lets %s animate out', (_description, task) => {
        // Its `inDone` flips, so the query it is listed by stops matching it — the collapse is just
        // covering a removal that is about to happen anyway.
        expect(rowRemainsAfterCompletion(task)).toBe(false)
    })

    it('never throws on a missing task', () => {
        expect(rowRemainsAfterCompletion(undefined)).toBe(false)
    })
})

describe('useTaskCompletionMotion', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        motion = null
        jest.useFakeTimers()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
    })

    afterEach(() => {
        jest.useRealTimers()
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
        expect(motion.completionWash).toBeNull()
        expect(motion.completionCelebration).toBeNull()
        // Load-bearing: an ordinary row must never carry a height from a stale measurement.
        expect(motion.rowStyle).toBeUndefined()
    })

    describe('a row that is about to be removed from its list', () => {
        it('runs the full sequence and holds the write until after the row has collapsed', async () => {
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

        it('leaves upward into the gap it is closing', async () => {
            enableAnimations()
            await renderHarness()

            act(() => motion.onRowLayout(layout(48)))
            await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))

            // A row that only shrinks reads as being deleted; the lift makes it read as leaving.
            const [{ translateY }] = motion.rowStyle.transform
            expect(translateY.__getValue()).toBe(0)
        })

        it('still strikes and sparkles a row that has never reported a height', async () => {
            enableAnimations()
            await renderHarness()

            // No onRowLayout at all. Collapsing from an unknown height would jump, so it is skipped
            // — but the completion must not silently do nothing.
            await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))

            expect(motion.completionStrike).not.toBeNull()
            expect(motion.completionCelebration).not.toBeNull()
            expect(motion.rowStyle).toBeUndefined()
        })
    })

    describe('a row that stays in its list (subtasks)', () => {
        /**
         * The regression this pass exists for. A subtask's write never touches `inDone` and no
         * subtask query filters on `done`, so nothing ever removes the row — collapsing it left an
         * invisible, zero-height, still-mounted row behind, and only a remount (collapsing the
         * parent, switching tab, navigating away) brought it back.
         */
        const beginRetained = async ({ height = 48 } = {}) => {
            await renderHarness({ retainRow: true })
            act(() => motion.onRowLayout(layout(height)))
            let holdMs
            await act(async () => {
                holdMs = motion.beginCompletionMotion({ strikeThrough: true })
            })
            return holdMs
        }

        it('never applies a row style, so the subtask cannot collapse', async () => {
            enableAnimations()
            await beginRetained()

            expect(motion.isCompleting).toBe(true)
            // Not "collapses back afterwards" — never collapses at all. There is no height, no
            // opacity and no overflow clip on the row at any point.
            expect(motion.rowStyle).toBeUndefined()
        })

        it('still gives the subtask the full completion feedback', async () => {
            enableAnimations()
            await beginRetained()

            expect(motion.completionStrike).not.toBeNull()
            expect(motion.completionWash).not.toBeNull()
            expect(motion.completionCelebration).not.toBeNull()
        })

        it('holds the write for less time than a collapsing row needs', async () => {
            enableAnimations()
            const holdMs = await beginRetained()

            // The extra buffer on a collapsing row exists purely to keep the write behind the
            // collapse. Nothing is racing here, so making the user wait for it would be dead time.
            expect(holdMs).toBe(RETAINED_HOLD_MS)
            expect(holdMs).toBeLessThan(COMPLETION_HOLD_MS)
        })

        it('releases the flourish afterwards and hands back an ordinary row', async () => {
            enableAnimations()
            await beginRetained()

            await act(async () => {
                jest.advanceTimersByTime(RELEASE_DELAY_MS + RELEASE_DURATION_MS)
            })

            // What is left is the normal done-subtask appearance — which is also what a reload
            // renders, so a subtask you just completed and one that was already done look the same.
            expect(motion.isCompleting).toBe(false)
            expect(motion.completionStrike).toBeNull()
            expect(motion.completionWash).toBeNull()
            expect(motion.completionCelebration).toBeNull()
            expect(motion.rowStyle).toBeUndefined()
        })

        it('releases on a shorter schedule with motion switched off', async () => {
            // Reduced motion draws the strike statically, so without a release it would sit on the
            // done subtask forever.
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
            enableAnimations()
            await beginRetained()

            expect(motion.completionStrike).not.toBeNull()
            await act(async () => {
                jest.advanceTimersByTime(REDUCED_MOTION_RELEASE_MS)
            })
            expect(motion.completionStrike).toBeNull()
        })

        it('resets immediately when the subtask is reopened', async () => {
            enableAnimations()
            let tree
            await act(async () => {
                tree = renderer.create(<Harness options={{ retainRow: true, isDone: false }} />)
                await Promise.resolve()
            })
            await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))

            // The write lands: the subtask is now done and still on screen.
            await act(async () => {
                tree.update(<Harness options={{ retainRow: true, isDone: true }} />)
            })
            // ...and the user unchecks it again. Nothing may survive that, whatever happened to the
            // release timer — a remount mid-flourish, a suite with motion disabled, a stopped
            // animation.
            await act(async () => {
                tree.update(<Harness options={{ retainRow: true, isDone: false }} />)
            })

            expect(motion.isCompleting).toBe(false)
            expect(motion.completionStrike).toBeNull()
            expect(motion.completionCelebration).toBeNull()
            expect(motion.rowStyle).toBeUndefined()
        })

        it('does not reset a completion that is still running', async () => {
            enableAnimations()
            let tree
            await act(async () => {
                tree = renderer.create(<Harness options={{ retainRow: true, isDone: false }} />)
                await Promise.resolve()
            })
            await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))

            // An open → open re-render (any unrelated store change) must not wipe the flourish
            // mid-sweep. Only the done → open edge clears it.
            await act(async () => {
                tree.update(<Harness options={{ retainRow: true, isDone: false }} />)
            })

            expect(motion.completionStrike).not.toBeNull()
        })
    })

    it('celebrates a completion but not a workflow step advance', async () => {
        enableAnimations()
        await renderHarness()

        await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))
        expect(motion.completionStrike).not.toBeNull()

        await act(async () => motion.cancelCompletionMotion())
        // A workflow task handed to the next reviewer leaves the list, so it still animates out,
        // but it is not done: no strike, no green wash and — the new one — no checkbox burst. It
        // would otherwise be told it had finished something it has only handed on.
        await act(async () => motion.beginCompletionMotion({ strikeThrough: false }))
        expect(motion.completionStrike).toBeNull()
        expect(motion.completionWash).toBeNull()
        expect(motion.completionCelebration).toBeNull()
        expect(motion.isCompleting).toBe(true)
    })

    it('drives the strike and the row wash from one value so they cannot drift', async () => {
        enableAnimations()
        await renderHarness()

        await act(async () => motion.beginCompletionMotion({ strikeThrough: true }))

        // The wash's leading edge IS the strike's head. Two values, however carefully tuned, would
        // read as two animations that happen to overlap.
        expect(motion.completionWash.progress).toBe(motion.completionStrike.progress)
        // And everything green fades in — and, on a retained row, back out — together.
        expect(motion.completionWash.opacity).toBe(motion.completionStrike.opacity)
        expect(motion.completionCelebration.opacity).toBe(motion.completionStrike.opacity)
    })

    it('shows a static frame and a shorter hold under prefers-reduced-motion', async () => {
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
        // The information survives without the motion: the line is there, fully drawn, immediately,
        // and the checkbox is green.
        expect(motion.completionStrike).toEqual(expect.objectContaining({ animated: false }))
        expect(motion.completionStrike.progress.__getValue()).toBe(1)
        expect(motion.completionCelebration.opacity.__getValue()).toBe(1)
        // The ring and the sparks carry nothing, so they are simply not run.
        expect(motion.completionCelebration.burst.__getValue()).toBe(0)
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
        expect(motion.completionCelebration).toBeNull()
        expect(motion.rowStyle).toBeUndefined()
    })

    describe('the shape of the sequence', () => {
        // Ordering invariants, asserted on the constants rather than by sampling a running
        // animation: they are what makes the beats read as one gesture instead of a pile-up.
        it('lets the tap land before the title is crossed out', () => {
            expect(STRIKE_DELAY_MS).toBeGreaterThan(0)
            expect(STRIKE_DELAY_MS).toBeLessThan(BURST_DURATION_MS)
        })

        it('brings every green thing in before the sweep is over', () => {
            expect(FLOURISH_FADE_IN_MS).toBeLessThan(STRIKE_DELAY_MS + STRIKE_DURATION_MS)
        })

        it('finishes the strike before the row starts leaving', () => {
            expect(STRIKE_DELAY_MS + STRIKE_DURATION_MS).toBeLessThanOrEqual(COLLAPSE_DELAY_MS)
        })

        it('finishes the burst before the row starts leaving', () => {
            // Sparks cut off mid-flight by a collapsing row is the one way this reads as a glitch.
            expect(BURST_DURATION_MS).toBeLessThanOrEqual(COLLAPSE_DELAY_MS)
        })

        it('keeps the whole sequence inside the write hold', () => {
            expect(COLLAPSE_DELAY_MS + COLLAPSE_DURATION_MS).toBeLessThan(COMPLETION_HOLD_MS)
        })

        it('starts a retained row releasing only after its write has landed', () => {
            // Otherwise the strike would fade out while the row still looked un-completed.
            expect(RELEASE_DELAY_MS).toBeGreaterThanOrEqual(RETAINED_HOLD_MS)
        })

        it('is longer than the pass it replaces but still under a second', () => {
            // The user asked for longer; "a bit" is not "clearing a list now takes a beat per row".
            expect(COMPLETION_HOLD_MS).toBeGreaterThan(700)
            expect(COMPLETION_HOLD_MS).toBeLessThanOrEqual(1000)
        })
    })
})
