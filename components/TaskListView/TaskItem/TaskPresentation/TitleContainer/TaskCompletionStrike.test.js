import React from 'react'
import { Animated, StyleSheet } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskCompletionStrike, { groupRectsIntoLines, resolveStrikeLineCount } from './TaskCompletionStrike'

/**
 * AT-2404. The strike is decoration, so the things worth pinning are the ways it can be wrong
 * without looking broken in a snapshot: growing from the wrong edge, drawing a different number of
 * bars than the title actually wraps to, and — the most visible one — spanning the whole title
 * COLUMN instead of the text, which turns "Buy milk" into a several-hundred-pixel line through
 * empty space.
 */

const renderStrike = props => {
    let tree
    act(() => {
        tree = renderer.create(
            <TaskCompletionStrike progress={new Animated.Value(0)} measuredHeight={24} isSubtask={false} {...props} />
        )
    })
    return tree
}

const scaler = tree => tree.root.findByProps({ testID: 'task-completion-strike-scaler' })
const bars = tree => scaler(tree).props.children

const rect = (top, left, right, height = 24) => ({ top, bottom: top + height, left, right, width: right - left })

describe('resolveStrikeLineCount', () => {
    it.each([
        ['a single line', 24, 24, 1],
        ['a title wrapped to two lines', 48, 24, 2],
        ['a title wrapped to three lines', 72, 24, 3],
        ['subtask metrics', 44, 22, 2],
    ])('counts %s', (_description, measuredHeight, lineHeight, expected) => {
        expect(resolveStrikeLineCount(measuredHeight, lineHeight)).toBe(expected)
    })

    it.each([
        ['no measurement yet', 0],
        ['an undefined height', undefined],
    ])('falls back to one line for %s', (_description, measuredHeight) => {
        // A layout can arrive before the text has measured. One line is both the right guess and
        // the safe one — it can never draw a bar through empty space below the text.
        expect(resolveStrikeLineCount(measuredHeight, 24)).toBe(1)
    })

    it('never draws more lines than the title can show', () => {
        // `numberOfLines={3}` caps the title, so a runaway measurement must not produce a stack of
        // bars below the text.
        expect(resolveStrikeLineCount(500, 24)).toBe(3)
    })
})

describe('groupRectsIntoLines', () => {
    const base = { top: 100, left: 50 }

    it('merges the per-word rects of one line into a single span', () => {
        // SocialText splits the title into per-word elements, so a range over it yields roughly one
        // rect per word. Three words on one line must produce ONE bar, not three.
        const lines = groupRectsIntoLines([rect(100, 50, 90), rect(100, 95, 140), rect(100, 145, 200)], base)

        expect(lines).toHaveLength(1)
        expect(lines[0].left).toBe(0)
        expect(lines[0].width).toBe(150)
    })

    it('sizes each bar to the ink of its own line, not to the column', () => {
        // The whole point: the second line is shorter, and its bar has to be shorter too.
        const lines = groupRectsIntoLines([rect(100, 50, 300), rect(124, 50, 160, 24)], base)

        expect(lines.map(line => line.width)).toEqual([250, 110])
    })

    it('groups sub-pixel line boxes together', () => {
        // Line boxes routinely differ by a fraction of a pixel; without rounding these would become
        // two nearly-identical overlapping bars.
        const lines = groupRectsIntoLines([rect(100.2, 50, 90), rect(99.8, 95, 140)], base)

        expect(lines).toHaveLength(1)
    })

    it('centres each bar on its line rather than on the box', () => {
        const lines = groupRectsIntoLines([rect(100, 50, 200, 24)], base)

        // Line ink runs 100→124, so its middle is 12 below the overlay top, less half the bar.
        expect(lines[0].top).toBeCloseTo(12 - 0.75)
    })

    it('orders lines top to bottom and never exceeds the three the title can show', () => {
        const lines = groupRectsIntoLines(
            [rect(172, 50, 120), rect(100, 50, 200), rect(148, 50, 180), rect(124, 50, 190)],
            base
        )

        expect(lines).toHaveLength(3)
        expect(lines.map(line => line.top)).toEqual([...lines.map(line => line.top)].sort((a, b) => a - b))
    })

    it.each([
        ['no rects', []],
        ['a missing base', null],
    ])('returns null for %s so the caller can fall back', (_description, rects) => {
        expect(groupRectsIntoLines(rects, rects ? null : base)).toBeNull()
    })
})

describe('TaskCompletionStrike', () => {
    it('grows from the left edge rather than from its own centre', () => {
        const style = StyleSheet.flatten(scaler(renderStrike()).props.style)

        // Without this the scaleX would expand outwards from the middle of the title, which reads
        // as a bar appearing rather than a line being drawn through the text.
        expect(style.transformOrigin).toBe('left center')
    })

    it('never intercepts a tap', () => {
        // The row stays fully interactive while it animates — same rule as
        // TaskRoutingActivityOverlay.
        const overlay = renderStrike().root.findByProps({ testID: 'task-completion-strike' })
        expect(overlay.props.pointerEvents).toBe('none')
    })

    it('drives every bar from one animated node', () => {
        // One scaleX for the whole overlay, so a three-line title costs one animation rather than
        // three that could drift apart.
        const style = StyleSheet.flatten(scaler(renderStrike({ measuredHeight: 72 })).props.style)

        expect(style.transform).toHaveLength(1)
        expect(style.transform[0]).toHaveProperty('scaleX')
    })

    describe('without a usable DOM measurement', () => {
        // react-test-renderer never puts the title in the document, so these exercise the fallback
        // path exactly as a non-web renderer would hit it.
        it('draws one full-width bar per wrapped line', () => {
            expect(bars(renderStrike({ measuredHeight: 24 }))).toHaveLength(1)
            expect(bars(renderStrike({ measuredHeight: 72 }))).toHaveLength(3)
        })

        it('stretches each bar across the column', () => {
            const style = StyleSheet.flatten(bars(renderStrike({ measuredHeight: 24 }))[0].props.style)

            // Unknown ink width, so the bar spans the column: wider than the text, but still
            // unmistakably a strike-through rather than nothing at all.
            expect(style.right).toBe(0)
            expect(style.width).toBeUndefined()
        })

        it('spaces subtask bars on the smaller body2 line height', () => {
            const [first, second] = bars(renderStrike({ measuredHeight: 44, isSubtask: true }))

            expect(StyleSheet.flatten(second.props.style).top - StyleSheet.flatten(first.props.style).top).toBe(22)
        })

        it('survives an element id that resolves to nothing', () => {
            expect(() => renderStrike({ elementId: 'social_text_missing' })).not.toThrow()
            expect(bars(renderStrike({ elementId: 'social_text_missing', measuredHeight: 24 }))).toHaveLength(1)
        })
    })
})
