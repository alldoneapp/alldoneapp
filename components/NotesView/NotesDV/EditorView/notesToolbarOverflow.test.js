import React from 'react'
import renderer, { act } from 'react-test-renderer'

import {
    EXPAND_HYSTERESIS_PX,
    MAX_TOOLBAR_STAGE,
    OVERFLOW_TOLERANCE_PX,
    TOOLBAR_STAGE_ACTIONS,
    TOOLBAR_STAGE_FULL,
    TOOLBAR_STAGE_LINK,
    createToolbarOverflowState,
    measureToolbarWidths,
    nextToolbarOverflowState,
    useNotesToolbarOverflow,
} from './notesToolbarOverflow'

// Nothing here needs a real toolbar: the point of splitting the state machine out of the
// component is that "when does it collapse, when does it come back, can it flap" is answerable
// without a layout engine (jsdom has none - every width below is one this module was handed).

describe('notes toolbar overflow state machine (AT-2427)', () => {
    const step = (state, overrides) =>
        nextToolbarOverflowState(state, { availableWidth: 800, contentWidth: 700, ...overrides })

    describe('collapsing', () => {
        it('stays fully expanded while the bar fits', () => {
            const state = step(createToolbarOverflowState(), { availableWidth: 1200, contentWidth: 900 })
            expect(state.stage).toBe(TOOLBAR_STAGE_FULL)
        })

        it('folds the after-Link actions away as soon as the bar overflows', () => {
            const state = step(createToolbarOverflowState(), { availableWidth: 700, contentWidth: 820 })
            expect(state.stage).toBe(TOOLBAR_STAGE_ACTIONS)
        })

        it('keeps collapsing while it still does not fit, one stage per measurement', () => {
            // Two passes rather than one jump: each stage has to be measured before the next
            // decision, because only the browser knows what the previous fold actually freed.
            const collapsed = step(createToolbarOverflowState(), { availableWidth: 380, contentWidth: 700 })
            expect(collapsed.stage).toBe(TOOLBAR_STAGE_ACTIONS)

            const collapsedFurther = step(collapsed, { availableWidth: 380, contentWidth: 520 })
            expect(collapsedFurther.stage).toBe(TOOLBAR_STAGE_LINK)
        })

        it('stops at the last stage instead of running off the end', () => {
            const state = step(createToolbarOverflowState(TOOLBAR_STAGE_LINK), {
                availableWidth: 200,
                contentWidth: 900,
            })
            expect(state.stage).toBe(MAX_TOOLBAR_STAGE)
        })

        it('never collapses past the ceiling the caller allows', () => {
            const state = step(createToolbarOverflowState(TOOLBAR_STAGE_ACTIONS), {
                availableWidth: 200,
                contentWidth: 900,
                maxStage: TOOLBAR_STAGE_ACTIONS,
            })
            expect(state.stage).toBe(TOOLBAR_STAGE_ACTIONS)
        })

        it('tolerates a sub-pixel overflow rather than collapsing for it', () => {
            const state = step(createToolbarOverflowState(), {
                availableWidth: 800,
                contentWidth: 800 + OVERFLOW_TOLERANCE_PX,
            })
            expect(state.stage).toBe(TOOLBAR_STAGE_FULL)
        })
    })

    describe('expanding again', () => {
        // The full bar needs 900px. Measure it once with room to spare so that width is known,
        // then squeeze the window until it no longer fits.
        const collapsedAt = availableWidth => {
            const measured = step(createToolbarOverflowState(), { availableWidth: 1000, contentWidth: 900 })
            return step(measured, { availableWidth, contentWidth: 900 })
        }

        it('comes back when the window is widened again', () => {
            const collapsed = collapsedAt(820)
            expect(collapsed.stage).toBe(TOOLBAR_STAGE_ACTIONS)

            const expanded = step(collapsed, { availableWidth: 1000, contentWidth: 700 })
            expect(expanded.stage).toBe(TOOLBAR_STAGE_FULL)
        })

        it('stays collapsed while the room gained back is not enough for the full bar', () => {
            const collapsed = collapsedAt(820)
            const stillCollapsed = step(collapsed, { availableWidth: 880, contentWidth: 700 })
            expect(stillCollapsed.stage).toBe(TOOLBAR_STAGE_ACTIONS)
        })

        it('cannot flap: re-expanding demands more room than the collapse itself freed', () => {
            // The bar needs 900. At exactly 900 a naive "does it fit" check would expand, the bar
            // would overflow by a rounding error, collapse, and start over on the next frame.
            const collapsed = collapsedAt(820)
            expect(step(collapsed, { availableWidth: 900, contentWidth: 700 }).stage).toBe(TOOLBAR_STAGE_ACTIONS)
            expect(step(collapsed, { availableWidth: 900 + EXPAND_HYSTERESIS_PX, contentWidth: 700 }).stage).toBe(
                TOOLBAR_STAGE_FULL
            )
        })

        it('will not expand into a width it has never measured', () => {
            // Collapsed straight away (a phone floor, a restored stage) - there is no expanded
            // measurement to compare against, so guessing would be the only alternative.
            const state = step(createToolbarOverflowState(TOOLBAR_STAGE_ACTIONS), {
                availableWidth: 4000,
                contentWidth: 500,
            })
            expect(state.stage).toBe(TOOLBAR_STAGE_ACTIONS)
        })

        it('never expands above the floor the caller forces', () => {
            const measured = step(createToolbarOverflowState(), { availableWidth: 1000, contentWidth: 900 })
            const collapsed = step(measured, { availableWidth: 820, contentWidth: 700 })
            const state = step(collapsed, {
                availableWidth: 4000,
                contentWidth: 700,
                minStage: TOOLBAR_STAGE_ACTIONS,
            })
            expect(state.stage).toBe(TOOLBAR_STAGE_ACTIONS)
        })
    })

    describe('measurements it must not act on', () => {
        it.each([
            ['a bar that has not been laid out', { availableWidth: 0, contentWidth: 0 }],
            ['a hidden bar', { availableWidth: 0, contentWidth: 700 }],
            ['a missing content reading', { availableWidth: 800, contentWidth: 0 }],
            ['a NaN reading', { availableWidth: NaN, contentWidth: NaN }],
            ['no measurement at all', {}],
        ])('leaves the stage alone for %s', (_label, measurement) => {
            const state = nextToolbarOverflowState(createToolbarOverflowState(), measurement)
            expect(state.stage).toBe(TOOLBAR_STAGE_FULL)
        })

        it('still applies a forced floor without any measurement', () => {
            // The phone path must not flash an overflowing bar for the frame before the first
            // measurement lands.
            const state = nextToolbarOverflowState(createToolbarOverflowState(), {
                minStage: TOOLBAR_STAGE_LINK,
            })
            expect(state.stage).toBe(TOOLBAR_STAGE_LINK)
        })
    })
})

describe('measureToolbarWidths', () => {
    const fakeElement = ({ clientWidth, scrollWidth, left = 0, width = clientWidth, children = [] }) => ({
        clientWidth,
        scrollWidth,
        getBoundingClientRect: () => ({ left, right: left + width, width }),
        children: children.map(child => ({
            getBoundingClientRect: () => ({
                left: child.left,
                right: child.right,
                width: child.right - child.left,
                height: child.height === undefined ? 40 : child.height,
            }),
        })),
    })

    it('reads the available width and the content width off the bar', () => {
        const measurement = measureToolbarWidths(
            fakeElement({
                clientWidth: 800,
                scrollWidth: 800,
                children: [
                    { left: 0, right: 300 },
                    { left: 300, right: 940 },
                ],
            })
        )
        expect(measurement).toEqual({ availableWidth: 800, contentWidth: 940 })
    })

    it("measures the groups' own right edges, not the scrollable overflow region", () => {
        // scrollWidth also counts absolutely positioned descendants, so the open "more" menu -
        // a 180px card anchored near the right end - would otherwise read as the bar overflowing
        // and collapse the row the user is currently using.
        const measurement = measureToolbarWidths(
            fakeElement({
                clientWidth: 800,
                scrollWidth: 1400, // as if an open popup had stretched the overflow region
                children: [
                    { left: 0, right: 300 },
                    { left: 300, right: 780 },
                ],
            })
        )
        expect(measurement.contentWidth).toBe(780)
    })

    it('falls back to scrollWidth for a bar that reports no children', () => {
        expect(measureToolbarWidths(fakeElement({ clientWidth: 800, scrollWidth: 940 }))).toEqual({
            availableWidth: 800,
            contentWidth: 940,
        })
    })

    it('ignores a folded-away group so a collapsed bar can measure as fitting', () => {
        // A `ql-hide` group reports an empty rect. Counting it would leave the collapsed bar
        // looking just as overflowing as the expanded one, and it would never come back.
        const measurement = measureToolbarWidths(
            fakeElement({
                clientWidth: 800,
                scrollWidth: 700,
                children: [
                    { left: 0, right: 700 },
                    { left: 0, right: 0, height: 0 },
                ],
            })
        )
        expect(measurement.contentWidth).toBe(700)
    })

    it('returns nothing for a ref that is not attached yet', () => {
        expect(measureToolbarWidths(null)).toBeNull()
        expect(measureToolbarWidths({})).toBeNull()
    })
})

describe('useNotesToolbarOverflow', () => {
    const Probe = ({ onState, ...options }) => {
        const overflow = useNotesToolbarOverflow(options)
        onState(overflow)
        return null
    }

    const mount = (options, element) => {
        const states = []
        let tree
        act(() => {
            tree = renderer.create(
                <Probe
                    {...options}
                    onState={state => {
                        states.push(state)
                        if (element) state.toolbarRef.current = element
                    }}
                />
            )
        })
        return { states, tree, latest: () => states[states.length - 1] }
    }

    const barOf = (clientWidth, scrollWidth) => ({
        clientWidth,
        scrollWidth,
        getBoundingClientRect: () => ({ left: 0, right: clientWidth, width: clientWidth }),
        children: [],
    })

    it('reports an expanded bar when nothing has been measured', () => {
        const { latest } = mount({})
        expect(latest().stage).toBe(TOOLBAR_STAGE_FULL)
        expect(latest().collapseActions).toBe(false)
        expect(latest().collapseLink).toBe(false)
    })

    it('starts collapsed when the caller forces a floor, before any measurement', () => {
        const { latest } = mount({ minStage: TOOLBAR_STAGE_LINK })
        expect(latest().collapseActions).toBe(true)
        expect(latest().collapseLink).toBe(true)
    })

    it('settles a two-stage collapse for a bar that is far too narrow', () => {
        // The element always reports more content than room, so the hook has to keep folding
        // until it runs out of stages - and stop there rather than spin.
        const element = {
            clientWidth: 320,
            scrollWidth: 900,
            getBoundingClientRect: () => ({ left: 0, right: 320, width: 320 }),
            children: [],
        }
        const { latest } = mount({}, element)
        expect(latest().stage).toBe(MAX_TOOLBAR_STAGE)
    })

    it('leaves the bar expanded when the measurement says it fits', () => {
        const { latest } = mount({}, barOf(1200, 900))
        expect(latest().stage).toBe(TOOLBAR_STAGE_FULL)
    })

    it('re-measures when the set of rendered controls changes', () => {
        // A bar that lost a button (labels dropped at a breakpoint, a collaborator left) has room
        // it did not have before, and the widths remembered per stage describe a bar that no
        // longer exists. The reset must re-measure even when the stage it resets TO is the stage
        // already rendered - nothing else would bring the hook back before the next resize.
        const element = {
            clientWidth: 320,
            scrollWidth: 900,
            getBoundingClientRect: () => ({ left: 0, right: 320, width: 320 }),
            children: [],
        }
        const states = []
        let tree
        act(() => {
            tree = renderer.create(
                <Probe
                    signature="a"
                    onState={state => {
                        states.push(state)
                        state.toolbarRef.current = element
                    }}
                />
            )
        })
        expect(states[states.length - 1].stage).toBe(MAX_TOOLBAR_STAGE)

        // Same signature, roomier bar: still collapsed, because the widths it remembers say the
        // expanded bar does not fit.
        element.clientWidth = 1200
        element.getBoundingClientRect = () => ({ left: 0, right: 1200, width: 1200 })

        act(() => {
            tree.update(
                <Probe
                    signature="b"
                    onState={state => {
                        states.push(state)
                        state.toolbarRef.current = element
                    }}
                />
            )
        })
        expect(states[states.length - 1].stage).toBe(TOOLBAR_STAGE_FULL)
    })

    it('exposes the two decisions the toolbar renders from', () => {
        const { latest } = mount({ minStage: TOOLBAR_STAGE_ACTIONS, maxStage: TOOLBAR_STAGE_ACTIONS })
        expect(latest().collapseActions).toBe(true)
        expect(latest().collapseLink).toBe(false)
    })
})
