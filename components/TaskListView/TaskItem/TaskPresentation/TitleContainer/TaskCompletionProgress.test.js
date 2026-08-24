import React from 'react'
import { Animated, StyleSheet } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { act as domAct } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'

import TaskCompletionProgress, {
    buildSweepSegments,
    groupRectsIntoLines,
    OPTICAL_OFFSET_Y,
    resolveProgressLineCount,
} from './TaskCompletionProgress'

/**
 * AT-2404. The completion sweep is decoration, so the things worth pinning are the ways it can be
 * wrong without looking broken in a snapshot: filling from the wrong edge, drawing a different
 * number of bars than the title actually wraps to, filling every wrapped line at once (which reads
 * as three progress bars rather than one), and — the most visible one — spanning the whole title
 * COLUMN instead of the text, which turns "Buy milk" into a several-hundred-pixel bar under empty
 * space.
 */

const renderProgress = props => {
    let tree
    act(() => {
        tree = renderer.create(
            <TaskCompletionProgress
                progress={new Animated.Value(0)}
                pulse={new Animated.Value(0)}
                measuredHeight={24}
                isSubtask={false}
                {...props}
            />
        )
    })
    return tree
}

// `deep: false` keeps each bar to ONE node: an Animated.View matches both as the composite
// element and as the host View it renders, which would otherwise double every count and make two
// sides of the same bar look like two different lines.
const bars = tree => tree.root.findAllByProps({ testID: 'task-completion-progress-bar' }, { deep: false })
const barStyle = (tree, index = 0) => StyleSheet.flatten(bars(tree)[index].props.style)

const rect = (top, left, right, height = 24) => ({ top, bottom: top + height, left, right, width: right - left })

describe('resolveProgressLineCount', () => {
    it.each([
        ['a single line', 24, 24, 1],
        ['a title wrapped to two lines', 48, 24, 2],
        ['a title wrapped to three lines', 72, 24, 3],
        ['subtask metrics', 44, 22, 2],
    ])('counts %s', (_description, measuredHeight, lineHeight, expected) => {
        expect(resolveProgressLineCount(measuredHeight, lineHeight)).toBe(expected)
    })

    it.each([
        ['no measurement yet', 0],
        ['an undefined height', undefined],
    ])('falls back to one line for %s', (_description, measuredHeight) => {
        // A layout can arrive before the text has measured. One line is both the right guess and
        // the safe one — it can never draw a bar under empty space below the text.
        expect(resolveProgressLineCount(measuredHeight, 24)).toBe(1)
    })

    it('never draws more lines than the title can show', () => {
        // `numberOfLines={3}` caps the title, so a runaway measurement must not produce a stack of
        // bars below the text.
        expect(resolveProgressLineCount(500, 24)).toBe(3)
    })
})

describe('buildSweepSegments', () => {
    /**
     * The heart of the "one bar, not three" rule. Every line gets the share of 0→1 that matches how
     * much text it holds, so the leading edge crosses a wrapped title at a constant speed.
     */
    it('gives a single line the whole sweep', () => {
        expect(buildSweepSegments([{ width: 180 }])).toEqual([{ start: 0, end: 1 }])
    })

    it('splits the sweep in proportion to the ink on each line', () => {
        const segments = buildSweepSegments([{ width: 300 }, { width: 100 }])

        // 3:1 of the text, so 3:1 of the time. Equal shares would make the head crawl along the
        // long line and then bolt across the short one.
        expect(segments[0]).toEqual({ start: 0, end: 0.75 })
        expect(segments[1]).toEqual({ start: 0.75, end: 1 })
    })

    it('hands the lines over back to back, with no gap and no overlap', () => {
        const segments = buildSweepSegments([{ width: 210 }, { width: 190 }, { width: 60 }])

        expect(segments[0].start).toBe(0)
        expect(segments[0].end).toBe(segments[1].start)
        expect(segments[1].end).toBe(segments[2].start)
        // Pinned exactly, not approximately: floating-point drift here would leave a hairline of
        // unfilled title at 100%, right where the confirmation pulse fires.
        expect(segments[2].end).toBe(1)
    })

    it('falls back to equal shares when the ink was never measured', () => {
        // The fallback path knows how MANY lines there are and nothing else, but the sweep must
        // still read sequentially rather than filling every line at once.
        expect(buildSweepSegments([{}, {}, {}])).toEqual([
            { start: 0, end: 1 / 3 },
            { start: 1 / 3, end: 2 / 3 },
            { start: 2 / 3, end: 1 },
        ])
    })

    it.each([
        ['no lines', []],
        ['a missing list', undefined],
    ])('returns nothing for %s', (_description, lines) => {
        expect(buildSweepSegments(lines)).toEqual([])
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

    it('runs the bar through the vertical centre of the line, not along its bottom', () => {
        const lines = groupRectsIntoLines([rect(100, 50, 200, 24)], base)

        // The user-visible bug this pins: the line box runs 100→124, so its centre is 12 below the
        // overlay top and the bar's own top edge is that less half its 3px thickness, plus the 1px
        // optical offset. Sitting it on the bottom edge (22.5) made it a detached underline.
        expect(lines[0].top).toBeCloseTo(12 - 1.5 + OPTICAL_OFFSET_Y)
        expect(lines[0].top + 3 / 2).toBeCloseTo(12 + OPTICAL_OFFSET_Y)
    })

    it('sits one pixel below the geometric centre of the line box', () => {
        // The correction dogfooding asked for: the geometrically centred bar read as slightly high,
        // because a line box is symmetric about the em box while the ink inside it is not. Pinned as
        // an exact pixel, not as "roughly centred" — the whole complaint was a one-pixel one, so a
        // tolerance wide enough to accept the old position would pin nothing at all.
        const lines = groupRectsIntoLines([rect(100, 50, 200, 24)], base)

        expect(lines[0].top + 3 / 2 - 12).toBeCloseTo(1)
        expect(OPTICAL_OFFSET_Y).toBe(1)
    })

    it('centres on the full union of the line, not on whichever rect arrived first', () => {
        // One line, two boxes of slightly different height and offset — a chip beside plain words.
        // The union is 100→124, so the centre is 12. Taking max(bottom) while keeping the first
        // rect's top would put it at 12.2: sub-pixel, but a bias with nothing behind it.
        const lines = groupRectsIntoLines([rect(100.4, 50, 120, 21.6), rect(100, 125, 200, 24)], base)

        expect(lines).toHaveLength(1)
        expect(lines[0].top + 3 / 2).toBeCloseTo(12 + OPTICAL_OFFSET_Y)
    })

    it('keeps each line centred on its own line box when the title wraps', () => {
        const [first, second] = groupRectsIntoLines([rect(100, 50, 200, 24), rect(124, 50, 180, 24)], base)

        // Centres 12 and 36 — one line height apart, each through its own text rather than both
        // drifting towards the bottom of the block.
        expect(first.top + 3 / 2).toBeCloseTo(12 + OPTICAL_OFFSET_Y)
        expect(second.top + 3 / 2).toBeCloseTo(36 + OPTICAL_OFFSET_Y)
        // The offset shifts the whole sweep, so it must not change the spacing BETWEEN lines: a
        // per-line nudge that accumulated would pull the last line of a wrapped title off its text.
        expect(second.top - first.top).toBeCloseTo(24)
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

describe('TaskCompletionProgress', () => {
    it('fills from the left edge rather than from its own centre', () => {
        // Without this the scaleX would expand outwards from the middle of the title, which reads
        // as a bar appearing rather than as progress being made.
        expect(barStyle(renderProgress()).transformOrigin).toBe('left center')
    })

    it('never intercepts a tap', () => {
        // The row stays fully interactive while it animates — same rule as
        // TaskRoutingActivityOverlay.
        const overlay = renderProgress().root.findByProps({ testID: 'task-completion-progress' })
        expect(overlay.props.pointerEvents).toBe('none')
    })

    it('shares one opacity with the rest of the flourish', () => {
        // The checkbox fill, the row wash and this bar all fade in — and, on a retained row, back
        // out again — off the same value, so they can never be seen arriving or leaving separately.
        const opacity = new Animated.Value(0)
        const overlay = renderProgress({ opacity }).root.findByProps({ testID: 'task-completion-progress' })

        expect(StyleSheet.flatten(overlay.props.style).opacity).toBe(opacity)
    })

    it.each([
        ['no opacity', { opacity: undefined }],
        ['no pulse', { pulse: undefined }],
    ])('renders with %s so it stays usable standalone', (_description, props) => {
        expect(() => renderProgress(props)).not.toThrow()
    })

    it('drives every line from the one shared sweep', () => {
        const progress = new Animated.Value(0)
        const tree = renderProgress({ progress, measuredHeight: 72 })

        // Three lines, three windows onto ONE value — not three animations that could drift apart.
        const parents = bars(tree).map(bar => StyleSheet.flatten(bar.props.style).transform[0].scaleX._parent)
        expect(parents).toEqual([progress, progress, progress])
    })

    it('confirms with the pulse rather than with the sweep', () => {
        const pulse = new Animated.Value(0)
        const style = barStyle(renderProgress({ pulse }))

        // The bar thickens on `pulse`, not on `progress`: a confirmation expressed as the tail of
        // the fill is indistinguishable from the fill still running.
        expect(style.transform[1].scaleY._parent).toBe(pulse)
        expect(style.transform[1].scaleY.__getValue()).toBe(1)
        act(() => pulse.setValue(0.45))
        expect(style.transform[1].scaleY.__getValue()).toBeGreaterThan(1)
        act(() => pulse.setValue(1))
        // ...and settles back, so what is left behind is the plain bar and not a fattened one.
        expect(style.transform[1].scaleY.__getValue()).toBe(1)
    })

    describe('without a usable DOM measurement', () => {
        // react-test-renderer never puts the title in the document, so these exercise the fallback
        // path exactly as a non-web renderer would hit it.
        it('draws one full-width bar per wrapped line', () => {
            expect(bars(renderProgress({ measuredHeight: 24 }))).toHaveLength(1)
            expect(bars(renderProgress({ measuredHeight: 72 }))).toHaveLength(3)
        })

        it('stretches each bar across the column', () => {
            const style = barStyle(renderProgress({ measuredHeight: 24 }))

            // Unknown ink width, so the bar spans the column: wider than the text, but still
            // unmistakably a completion sweep rather than nothing at all.
            expect(style.right).toBe(0)
            expect(style.width).toBeUndefined()
        })

        it('still fills the lines one after another', () => {
            const [first, second] = bars(renderProgress({ measuredHeight: 48 })).map(
                bar => StyleSheet.flatten(bar.props.style).transform[0].scaleX
            )

            // Halfway through the sweep, a two-line title has line one full and line two empty.
            act(() => first._parent.setValue(0.5))
            expect(first.__getValue()).toBe(1)
            expect(second.__getValue()).toBe(0)
        })

        it('spaces subtask bars on the smaller body2 line height', () => {
            const tree = renderProgress({ measuredHeight: 44, isSubtask: true })

            expect(barStyle(tree, 1).top - barStyle(tree, 0).top).toBe(22)
        })

        it('centres the bar in the line box even with nothing measured', () => {
            // The fallback must agree with the measured path, or a row that fails to measure would
            // show the underline the measured path no longer draws.
            const top = barStyle(renderProgress({ measuredHeight: 24 })).top

            // Text starts 5 below the overlay (TEXT_MARGIN_TOP) on a 24px line, so the centre is
            // 5 + 12, the bar's top edge is half its 3px thickness above it, and the optical offset
            // takes it 1px back down.
            expect(top + 3 / 2).toBeCloseTo(5 + 12 + OPTICAL_OFFSET_Y)
        })

        it('applies the same one-pixel optical offset as the measured path', () => {
            // The two paths are computed independently, so this is the assertion that stops one of
            // them being corrected and the other quietly left on the geometric centre — which is
            // precisely what happened to the thickness correction in the centring pass.
            const top = barStyle(renderProgress({ measuredHeight: 24 })).top

            expect(top + 3 / 2 - (5 + 12)).toBeCloseTo(1)
        })

        it('centres every line of a wrapped fallback title on its own line box', () => {
            const tree = renderProgress({ measuredHeight: 72 })
            const centers = [0, 1, 2].map(index => barStyle(tree, index).top + 3 / 2)

            expect(centers).toEqual([5 + 12 + OPTICAL_OFFSET_Y, 5 + 36 + OPTICAL_OFFSET_Y, 5 + 60 + OPTICAL_OFFSET_Y])
        })

        it('centres a subtask bar on the smaller body2 line box', () => {
            const top = barStyle(renderProgress({ measuredHeight: 22, isSubtask: true })).top

            // 22px line height, 6px top margin — and the same 1px offset, because a subtask plays
            // every beat of the sweep except the collapse.
            expect(top + 3 / 2).toBeCloseTo(6 + 11 + OPTICAL_OFFSET_Y)
        })

        it('survives an element id that resolves to nothing', () => {
            expect(() => renderProgress({ elementId: 'social_text_missing' })).not.toThrow()
            expect(bars(renderProgress({ elementId: 'social_text_missing', measuredHeight: 24 }))).toHaveLength(1)
        })

        it('draws no leading head, because it does not know where the line ends', () => {
            // A head parked at the column's right edge would sit in empty space well past the text.
            // Better to lose the flourish than to point at nothing.
            expect(
                renderProgress({ measuredHeight: 24 }).root.findAllByProps(
                    { testID: 'task-completion-progress-head' },
                    { deep: false }
                )
            ).toHaveLength(0)
        })
    })

    describe('with a measured title (the real DOM path)', () => {
        /**
         * `measureTitleLines` is DOM-only — it needs a real element to range over and a real
         * overlay box to map the rects into — so the measured path can only be reached through
         * react-dom. It is worth the extra machinery: this is the branch that runs in production
         * for every completion, and the fallback above is only ever the safety net.
         */
        const SINGLE_LINE = [{ top: 10, bottom: 26, left: 20, right: 120, width: 100, height: 16 }]
        const TWO_LINES = [
            { top: 10, bottom: 26, left: 20, right: 220, width: 200, height: 16 },
            { top: 34, bottom: 50, left: 20, right: 120, width: 100, height: 16 },
        ]
        const TITLE_ID = 'social_text_measured'

        let originalCreateRange
        let host

        beforeEach(() => {
            originalCreateRange = document.createRange
            // jsdom has no layout, so the rects a browser would produce are supplied here. Modelled
            // as real ink INSIDE a wider column (left: 20, not 0), which is the whole point of
            // measuring — see `groupRectsIntoLines`.
            document.createRange = () => ({ selectNodeContents: () => {}, getClientRects: () => SINGLE_LINE })
        })

        afterEach(() => {
            document.createRange = originalCreateRange
            if (host) {
                document.body.removeChild(host)
                host = null
            }
        })

        const renderInDom = (props = {}) => {
            const title = document.createElement('div')
            title.id = TITLE_ID
            document.body.appendChild(title)
            host = document.createElement('div')
            document.body.appendChild(host)
            const root = createRoot(host)
            domAct(() => {
                root.render(
                    <TaskCompletionProgress
                        progress={new Animated.Value(0)}
                        pulse={new Animated.Value(0)}
                        measuredHeight={24}
                        isSubtask={false}
                        elementId={TITLE_ID}
                        {...props}
                    />
                )
            })
            document.body.removeChild(title)
            return host
        }

        const query = (node, testID) => node.querySelectorAll(`[data-testid="${testID}"]`)

        it('sizes the bar to the ink rather than to the flex column', () => {
            const bar = query(renderInDom(), 'task-completion-progress-bar')[0]

            // 100px of text, offset 20px into the column. A column-wide bar here would run several
            // hundred pixels under empty space on a desktop row.
            expect(bar.style.width).toBe('100px')
            expect(bar.style.left).toBe('20px')
        })

        it('runs the bar through the middle of the measured line, not under it', () => {
            const bar = query(renderInDom(), 'task-completion-progress-bar')[0]

            // The production bug, pinned on the production path. The line box runs 10→26, so its
            // centre is 18, the bar's top edge is 16.5 and the 1px optical offset puts it at 17.5.
            // The underline this replaced sat at 24.5.
            expect(bar.style.top).toBe('17.5px')
        })

        it('carries the head at the same height as the bar it leads', () => {
            const node = renderInDom()
            const bar = query(node, 'task-completion-progress-bar')[0]
            const head = query(node, 'task-completion-progress-head')[0]

            // The head is thicker than the bar, so it is offset by half the difference to keep the
            // two concentric. A head that drifted off the bar would read as two separate marks —
            // and because the head derives from the same `top`, the optical offset moves both or
            // neither. This is the assertion that catches an offset applied to only one of them.
            expect(parseFloat(head.style.top) + 5 / 2).toBeCloseTo(parseFloat(bar.style.top) + 3 / 2)
            expect(head.style.top).toBe('16.5px')
        })

        it('centres each wrapped line on its own line box', () => {
            document.createRange = () => ({ selectNodeContents: () => {}, getClientRects: () => TWO_LINES })
            const bars = query(renderInDom(), 'task-completion-progress-bar')

            // Line boxes 10→26 and 34→50: centres 18 and 42, so tops 16.5 and 40.5, each shifted a
            // pixel down. Both centred on their own text rather than both sinking towards the
            // bottom of the block, and still exactly one line height apart.
            expect([...bars].map(bar => bar.style.top)).toEqual(['17.5px', '41.5px'])
        })

        it('draws one leading head per measured line', () => {
            // The bright tip that makes the fill read as ADVANCING rather than as a shape growing.
            expect(query(renderInDom(), 'task-completion-progress-head')).toHaveLength(1)
        })

        it('travels the head along the line it belongs to', () => {
            const progress = new Animated.Value(0)
            const node = renderInDom({ progress })
            const head = query(node, 'task-completion-progress-head')[0]

            const atStart = head.style.transform
            domAct(() => progress.setValue(1))
            // It has to end somewhere else — a head pinned at the start is worse than no head.
            expect(head.style.transform).not.toBe(atStart)
        })

        it('blooms the head out on the confirmation instead of leaving it lit', () => {
            const pulse = new Animated.Value(0)
            const head = query(
                renderInDom({ progress: new Animated.Value(1), pulse }),
                'task-completion-progress-head'
            )[0]

            expect(Number(head.style.opacity)).toBeCloseTo(1)
            domAct(() => pulse.setValue(1))
            // A tip still burning at the end of a finished bar reads as "stuck at 100%".
            expect(Number(head.style.opacity)).toBeCloseTo(0)
        })

        describe('a title wrapped over two lines', () => {
            beforeEach(() => {
                document.createRange = () => ({ selectNodeContents: () => {}, getClientRects: () => TWO_LINES })
            })

            it('fills the lines one after another, not both at once', () => {
                const progress = new Animated.Value(0)
                const node = renderInDom({ progress })
                const [first, second] = query(node, 'task-completion-progress-bar')

                // 200px + 100px of ink, so line one owns the first two thirds of the sweep. At the
                // halfway mark line one is three quarters full and line two has not started.
                domAct(() => progress.setValue(0.5))
                expect(first.style.transform).toContain('scaleX(0.75)')
                expect(second.style.transform).toContain('scaleX(0)')

                domAct(() => progress.setValue(1))
                expect(first.style.transform).toContain('scaleX(1)')
                expect(second.style.transform).toContain('scaleX(1)')
            })

            it('carries one head at a time across the wrap', () => {
                const progress = new Animated.Value(0)
                const node = renderInDom({ progress })
                const [first, second] = query(node, 'task-completion-progress-head')

                // Mid-way through line one: its head is lit and line two's is not yet.
                domAct(() => progress.setValue(0.4))
                expect(Number(first.style.opacity)).toBeCloseTo(1)
                expect(Number(second.style.opacity)).toBeCloseTo(0)

                // Once the sweep has moved on, line one must not keep a lit dot at its right edge.
                domAct(() => progress.setValue(0.9))
                expect(Number(first.style.opacity)).toBeCloseTo(0)
                expect(Number(second.style.opacity)).toBeCloseTo(1)
            })
        })

        it('recovers to the fallback when the measurement throws', () => {
            document.createRange = () => {
                throw new Error('no layout')
            }

            // ANY problem falls back to full-width bars: the sweep still says "done", which is the
            // thing that matters, and nothing about a decoration may take the row down.
            const node = renderInDom()
            expect(query(node, 'task-completion-progress')).toHaveLength(1)
            expect(query(node, 'task-completion-progress-head')).toHaveLength(0)
        })
    })
})
