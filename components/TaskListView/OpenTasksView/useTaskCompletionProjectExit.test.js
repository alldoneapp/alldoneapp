import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo } from 'react-native'

import useTaskCompletionProjectExit, {
    TASK_COMPLETION_PROJECT_EXIT_HOLD_MS,
    TASK_COMPLETION_PROJECT_EXIT_MEMORY_MS,
} from './useTaskCompletionProjectExit'
import { publishProjectTaskCompletion, resetProjectTaskCompletionListeners } from './projectTaskCompletionSignal'

const PROJECT = 'project-1'
let latest

const Host = ({ projectId = PROJECT, enabled = true, lineWouldLeave = false }) => {
    latest = useTaskCompletionProjectExit({ projectId, enabled, lineWouldLeave })
    return null
}

describe('useTaskCompletionProjectExit (AT-2558)', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-09-11T17:00:00Z'))
        resetProjectTaskCompletionListeners()
        process.env.NODE_ENV = 'development'
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        window.matchMedia = jest.fn(() => ({
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            addListener: jest.fn(),
            removeListener: jest.fn(),
        }))
    })

    afterEach(() => {
        jest.useRealTimers()
        process.env.NODE_ENV = originalNodeEnv
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
    })

    const render = async (props = {}) => {
        let tree
        await act(async () => {
            tree = renderer.create(<Host {...props} />)
        })
        return tree
    }

    const update = async (tree, props = {}) => {
        await act(async () => tree.update(<Host {...props} />))
    }

    it('holds only after a reported task completion and an actual project departure', async () => {
        const tree = await render()

        await act(async () => {
            publishProjectTaskCompletion({ projectId: PROJECT, taskId: 'last-task' })
        })
        expect(latest.holdProjectLine).toBe(false)

        await update(tree, { lineWouldLeave: true })
        expect(latest.exitRunId).toBe(1)
        expect(latest.holdProjectLine).toBe(true)

        await act(async () => jest.advanceTimersByTime(TASK_COMPLETION_PROJECT_EXIT_HOLD_MS))
        expect(latest.holdProjectLine).toBe(false)
    })

    it('does not hold an ordinary project removal', async () => {
        const tree = await render()

        await update(tree, { lineWouldLeave: true })

        expect(latest.exitRunId).toBe(0)
        expect(latest.holdProjectLine).toBe(false)
    })

    it('does not borrow a completion from another project', async () => {
        const tree = await render()
        await act(async () => {
            publishProjectTaskCompletion({ projectId: 'project-2', taskId: 'last-task' })
        })

        await update(tree, { lineWouldLeave: true })

        expect(latest.holdProjectLine).toBe(false)
    })

    it('does not borrow stale completion evidence', async () => {
        const tree = await render()
        await act(async () => {
            publishProjectTaskCompletion({ projectId: PROJECT, taskId: 'last-task' })
            jest.advanceTimersByTime(TASK_COMPLETION_PROJECT_EXIT_MEMORY_MS + 1)
        })

        await update(tree, { lineWouldLeave: true })

        expect(latest.holdProjectLine).toBe(false)
    })

    it('does not delay removal when reduced motion is requested', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        window.matchMedia = jest.fn(() => ({
            matches: true,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            addListener: jest.fn(),
            removeListener: jest.fn(),
        }))
        const tree = await render()

        await act(async () => {
            publishProjectTaskCompletion({ projectId: PROJECT, taskId: 'last-task' })
        })
        await update(tree, { lineWouldLeave: true })

        expect(latest.holdProjectLine).toBe(false)
    })
})
