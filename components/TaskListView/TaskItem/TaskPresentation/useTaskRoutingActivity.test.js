import React from 'react'
import { AccessibilityInfo, Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import useTaskRoutingActivity, {
    ROUTING_CONFIRMATION_VISIBLE_MS,
    resetPlayedRoutingConfirmations,
} from './useTaskRoutingActivity'
import { ROUTING_PROCESSING_WINDOW_MS } from '../../../../utils/taskRoutingActivity'

/**
 * AT-2381 — the hook's whole job beyond the pure derivation is the once-per-decision latch.
 *
 * That latch matters because the evidence for a confirmation (`status: 'routed'` + `resolvedAt`)
 * lives on the task document permanently, while the animation is an edge. In a virtualised list
 * a row unmounts and remounts every time it scrolls out of view and back, so without the latch a
 * user scrolling up and down would re-trigger the same celebration indefinitely.
 */

const NOW = 1_700_000_000_000
const HOST = 'project-host'
const TARGET = 'project-target'

const movedTask = (resolvedAt = NOW - 500) => ({
    id: 'task-1',
    parentGoalId: null,
    projectRouting: { status: 'routed', resolvedAt, movedFromProjectId: HOST },
})

let latest

function Probe({ task, projectId }) {
    latest = useTaskRoutingActivity(task, projectId)
    return <Text>probe</Text>
}

const render = async (task, projectId) => {
    let tree
    await act(async () => {
        tree = renderer.create(<Probe task={task} projectId={projectId} />)
        await Promise.resolve()
    })
    return tree
}

describe('useTaskRoutingActivity', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(NOW)
        resetPlayedRoutingConfirmations()
        latest = undefined
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
    })

    it('reports a fresh move as a confirmation in the destination project', async () => {
        await render(movedTask(), TARGET)

        expect(latest.confirmation).toMatchObject({ subject: 'project', fromProjectId: HOST })
        expect(latest.processing).toBeNull()
    })

    it('plays a confirmation only once, however often the row remounts', async () => {
        const task = movedTask()

        await render(task, TARGET)
        expect(latest.confirmation).not.toBeNull()

        // Same task, same decision, brand new mount — a scroll away and back.
        await render(task, TARGET)
        expect(latest.confirmation).toBeNull()
    })

    it('still plays when the SAME task is routed again later', async () => {
        await render(movedTask(NOW - 500), TARGET)
        expect(latest.confirmation).not.toBeNull()

        await render(movedTask(NOW - 100), TARGET)
        expect(latest.confirmation).not.toBeNull()
    })

    it('retires the confirmation after its visible lifetime', async () => {
        await render(movedTask(), TARGET)
        expect(latest.confirmation).not.toBeNull()

        await act(async () => {
            jest.advanceTimersByTime(ROUTING_CONFIRMATION_VISIBLE_MS + 10)
        })

        expect(latest.confirmation).toBeNull()
    })

    it('reports the sparkle while classification is still running', async () => {
        await render({ id: 'task-2', projectRouting: { status: 'classifying', startedAt: NOW } }, HOST)

        expect(latest.processing).toEqual({ subject: 'project' })
        expect(latest.confirmation).toBeNull()
    })

    it('retires a stranded processing indicator without waiting for another snapshot', async () => {
        await render({ id: 'task-2', goalSuggestion: { status: 'classifying', createdAt: NOW } }, HOST)
        expect(latest.processing).toEqual({ subject: 'goal' })

        await act(async () => {
            jest.advanceTimersByTime(ROUTING_PROCESSING_WINDOW_MS + 10)
        })

        expect(latest.processing).toBeNull()
    })

    it('never reports processing and confirmation at the same time', async () => {
        await render(
            {
                id: 'task-3',
                parentGoalId: null,
                projectRouting: { status: 'routed', resolvedAt: NOW - 200, movedFromProjectId: HOST },
                goalSuggestion: { status: 'classifying', createdAt: NOW },
            },
            TARGET
        )

        expect(latest.confirmation).not.toBeNull()
        expect(latest.processing).toBeNull()
    })

    it('says nothing at all about an ordinary task', async () => {
        await render({ id: 'task-4', parentGoalId: null }, HOST)

        expect(latest.processing).toBeNull()
        expect(latest.confirmation).toBeNull()
    })

    it('does not subscribe to the reduced-motion preference', async () => {
        // This hook runs on EVERY task row, and `useReducedMotion` registers a `matchMedia`
        // listener per call — so reading the preference here would cost one listener per row of a
        // long list to serve the handful actually being routed. The two presentational components
        // subscribe for themselves, and the row mounts them only when there is something to show.
        await render(movedTask(), TARGET)

        expect(AccessibilityInfo.addEventListener).not.toHaveBeenCalled()
        expect(latest.reducedMotion).toBeUndefined()
    })
})
