import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import usePagedReveal, { PAGED_REVEAL_TIMEOUT_MS, scheduleAfterPaint } from './usePagedReveal'

/**
 * AT-2385 — the paging behind the Contacts "Show more" / chevron-down.
 *
 * The contract under test is the WINDOW: a press must open a real interval during which
 * the ghosts are up and the rows are not yet mounted, and that interval must close on the
 * next painted frame (or, in a background tab where rAF never fires, on the backstop).
 */

// A hand-driven stand-in for `scheduleAfterPaint`, so a test can hold the reveal open and
// assert what the list looks like mid-flight. Returning a canceller keeps it honest about
// the real contract.
const createManualScheduler = () => {
    const pending = []
    const schedule = callback => {
        const entry = { callback, cancelled: false }
        pending.push(entry)
        return () => {
            entry.cancelled = true
        }
    }
    schedule.flush = () => {
        const runnable = pending.filter(entry => !entry.cancelled)
        pending.length = 0
        runnable.forEach(entry => entry.callback())
    }
    schedule.pendingCount = () => pending.filter(entry => !entry.cancelled).length
    return schedule
}

let api

const Probe = ({ totalCount, pageSize, initialAmount, schedule }) => {
    api = usePagedReveal(totalCount, pageSize, { initialAmount, schedule })
    return <Text testID="state">{`${api.visibleAmount}|${api.loadingMore ? 'loading' : 'idle'}`}</Text>
}

describe('usePagedReveal', () => {
    let schedule

    const mount = (props = {}) => {
        schedule = props.schedule || createManualScheduler()
        const merged = { totalCount: 25, pageSize: 10, initialAmount: 10, ...props, schedule }
        let tree
        act(() => {
            tree = renderer.create(<Probe {...merged} />)
        })
        return { tree, props: merged }
    }

    const rerender = (tree, props) => {
        act(() => {
            tree.update(<Probe {...props} />)
        })
    }

    const press = fn => act(() => fn())

    const flush = () => act(() => schedule.flush())

    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('starts collapsed at the initial amount and is not loading', () => {
        mount()
        expect(api.visibleAmount).toBe(10)
        expect(api.loadingMore).toBe(false)
        expect(api.expanded).toBe(false)
        expect(api.canExpand).toBe(true)
        expect(api.incomingCount).toBe(0)
    })

    it('opens a real loading window on press and only reveals after the paint', () => {
        mount()

        press(api.expand)

        // The whole point: the rows are NOT on screen yet, so the ghosts have something to
        // cover. Before AT-2385 this transition did not exist at all.
        expect(api.loadingMore).toBe(true)
        expect(api.visibleAmount).toBe(10)
        expect(api.incomingCount).toBe(10)

        flush()

        expect(api.loadingMore).toBe(false)
        expect(api.visibleAmount).toBe(20)
        expect(api.incomingCount).toBe(0)
    })

    it('reveals ONE page per press instead of the whole remainder', () => {
        mount({ totalCount: 250, pageSize: 10, initialAmount: 10 })

        press(api.expand)
        flush()
        expect(api.visibleAmount).toBe(20)

        press(api.expand)
        flush()
        expect(api.visibleAmount).toBe(30)
        expect(api.canExpand).toBe(true)
    })

    it('never reveals past the end of the list', () => {
        mount({ totalCount: 13, pageSize: 10, initialAmount: 10 })

        press(api.expand)
        flush()

        expect(api.visibleAmount).toBe(13)
        expect(api.canExpand).toBe(false)
        expect(api.expanded).toBe(true)
    })

    it('ignores a second press while a page is still in flight', () => {
        mount()

        press(api.expand)
        const scheduledAfterFirstPress = schedule.pendingCount()
        press(api.expand)

        expect(schedule.pendingCount()).toBe(scheduledAfterFirstPress)
        expect(api.incomingCount).toBe(10)

        flush()
        // One press, one page - the second press must not have moved the target.
        expect(api.visibleAmount).toBe(20)
    })

    it('does nothing when there is nothing left to reveal', () => {
        mount({ totalCount: 10, pageSize: 10, initialAmount: 10 })

        press(api.expand)

        expect(api.loadingMore).toBe(false)
        expect(api.canExpand).toBe(false)
    })

    it('collapses instantly, with no ghosts, because unmounting waits for nothing', () => {
        mount()

        press(api.expand)
        flush()
        expect(api.visibleAmount).toBe(20)

        press(api.collapse)

        expect(api.visibleAmount).toBe(10)
        expect(api.loadingMore).toBe(false)
        expect(api.expanded).toBe(false)
    })

    it('reveals anyway when the frame never comes (background tab)', () => {
        // rAF does not fire in a hidden tab. The backstop must deliver the CONTENT, not
        // merely drop the flag - otherwise the press is silently lost.
        mount()

        press(api.expand)
        expect(api.visibleAmount).toBe(10)

        act(() => jest.advanceTimersByTime(PAGED_REVEAL_TIMEOUT_MS))

        expect(api.visibleAmount).toBe(20)
        expect(api.loadingMore).toBe(false)
    })

    it('drops an expansion when the collapsed size changes (project switch)', () => {
        const { tree, props } = mount()

        press(api.expand)
        flush()
        expect(api.visibleAmount).toBe(20)

        rerender(tree, { ...props, initialAmount: 3 })

        expect(api.visibleAmount).toBe(3)
        expect(api.loadingMore).toBe(false)
    })

    it('hides the collapse affordance when a filter shrinks the list below one page', () => {
        const { tree, props } = mount()

        press(api.expand)
        flush()
        expect(api.expanded).toBe(true)

        rerender(tree, { ...props, totalCount: 4 })

        // 4 contacts and a collapsed size of 10: there is nothing to collapse to, so the
        // chevron must not offer it.
        expect(api.expanded).toBe(false)
        expect(api.canExpand).toBe(false)
    })

    describe('scheduleAfterPaint', () => {
        it('waits for a second frame, so the ghosts are actually painted once', () => {
            const frames = []
            const originalRaf = global.requestAnimationFrame
            const originalCancel = global.cancelAnimationFrame
            global.requestAnimationFrame = cb => frames.push(cb)
            global.cancelAnimationFrame = jest.fn()

            const run = jest.fn()
            scheduleAfterPaint(run)

            // rAF callbacks run after React's commit but BEFORE that frame is painted, so
            // one frame would swap the ghosts out before anyone saw them.
            expect(frames).toHaveLength(1)
            frames[0]()
            expect(run).not.toHaveBeenCalled()

            expect(frames).toHaveLength(2)
            frames[1]()
            expect(run).toHaveBeenCalledTimes(1)

            global.requestAnimationFrame = originalRaf
            global.cancelAnimationFrame = originalCancel
        })

        it('falls back to a timer where requestAnimationFrame does not exist', () => {
            const originalRaf = global.requestAnimationFrame
            delete global.requestAnimationFrame

            const run = jest.fn()
            const cancel = scheduleAfterPaint(run)
            jest.advanceTimersByTime(0)
            expect(run).toHaveBeenCalledTimes(1)
            expect(typeof cancel).toBe('function')

            global.requestAnimationFrame = originalRaf
        })
    })
})
