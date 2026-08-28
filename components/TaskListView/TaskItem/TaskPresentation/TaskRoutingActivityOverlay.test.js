import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskRoutingActivityOverlay from './TaskRoutingActivityOverlay'

const render = async element => {
    let tree
    await act(async () => {
        tree = renderer.create(element)
        await Promise.resolve()
    })
    return tree
}

describe('TaskRoutingActivityOverlay', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener

    beforeEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
    })

    afterEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
    })

    it('renders nothing for a task with no routing activity', async () => {
        const tree = await render(<TaskRoutingActivityOverlay confirmation={null} />)

        expect(tree.toJSON()).toBeNull()
    })

    it('glows once the decision changed the task', async () => {
        const tree = await render(<TaskRoutingActivityOverlay confirmation={{ subject: 'project' }} />)

        expect(tree.root.findByProps({ testID: 'task-routing-glow' })).toBeTruthy()
    })

    it('stands down completely under reduced motion', async () => {
        // The badge carries the message; this layer is pure decoration, so it is the right thing
        // to drop entirely rather than to slow down.
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const confirmed = await render(<TaskRoutingActivityOverlay confirmation={{ subject: 'goal' }} />)

        expect(confirmed.toJSON()).toBeNull()
    })

    it('never intercepts pointer events on the row it covers', async () => {
        // The single most important property here: a task being classified must stay completable,
        // draggable and editable. An overlay that ate taps would break the row for the seconds it
        // is shown, on exactly the task the user just created and is most likely to act on.
        const tree = await render(<TaskRoutingActivityOverlay confirmation={{ subject: 'project' }} />)

        expect(tree.root.findByProps({ testID: 'task-routing-glow' }).props.pointerEvents).toBe('none')
    })

    /**
     * AT-2453 follow-up — the in-progress sweep is gone and must stay gone.
     *
     * It was an INDEFINITE loop (bounded only by `useTaskRoutingActivity`'s ten-minute stale-state
     * backstop) travelling across the title of the task the user had just typed. What replaced it is
     * `TaskRoutingTag`'s `project?` / `goal?` label, which says strictly more and moves nothing.
     *
     * Asserted behaviourally rather than by grepping the source: the guarantee that matters is that
     * a row being classified gets NO motion layer, however that ends up being implemented.
     */
    describe('the in-progress row sweep is gone (AT-2453)', () => {
        it('renders nothing at all while the server is still deciding', async () => {
            // Passed positionally the way the row used to pass it, so a revert that reinstates the
            // `processing` branch fails here rather than being silently ignored by the new signature.
            const project = await render(
                <TaskRoutingActivityOverlay processing={{ subject: 'project' }} confirmation={null} />
            )
            const goal = await render(
                <TaskRoutingActivityOverlay processing={{ subject: 'goal' }} confirmation={null} />
            )

            expect(project.toJSON()).toBeNull()
            expect(goal.toJSON()).toBeNull()
        })

        it('exposes no sweep node and no sweep constants any more', async () => {
            const tree = await render(
                <TaskRoutingActivityOverlay processing={{ subject: 'project' }} confirmation={{ subject: 'project' }} />
            )

            expect(tree.root.findAllByProps({ testID: 'task-routing-sweep' })).toHaveLength(0)

            const moduleExports = require('./TaskRoutingActivityOverlay')
            expect(Object.keys(moduleExports).filter(name => name.startsWith('SWEEP_'))).toEqual([])
        })
    })
})
