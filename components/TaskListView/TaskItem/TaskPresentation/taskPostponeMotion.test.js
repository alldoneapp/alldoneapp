import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, View } from 'react-native'

import useTaskPostponeMotion, {
    POSTPONE_COLLAPSE_MS,
    POSTPONE_EXIT_TOTAL_MS,
    POSTPONE_REDUCED_FADE_MS,
    POSTPONE_SLIDE_FADE_MS,
    POSTPONE_TRANSLATE_X,
    postponeTaskWithMotion,
    resetTaskPostponeMotionRegistry,
    targetLeavesToday,
} from './taskPostponeMotion'

let motion
const PROJECT = 'project-1'
const TASK = { id: 'task-1', parentGoalId: 'goal-1' }
const pageStyle = { flex: 1 }
const headerStyle = { paddingTop: 8 }
const siblingStyle = { marginTop: 12 }
const entryStyle = { paddingBottom: 8 }

const Harness = ({ options = {} }) => {
    motion = useTaskPostponeMotion({ enabled: true, projectId: PROJECT, taskId: TASK.id, ...options })
    return (
        <View testID="page" style={pageStyle}>
            <View testID="header" style={headerStyle} />
            <View testID="task" style={motion.rowStyle} />
            <View testID="sibling-goal-section" style={siblingStyle} />
            <View testID="entry-row" style={entryStyle} />
        </View>
    )
}

describe('task postpone motion (AT-2541)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        resetTaskPostponeMotionRegistry()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        process.env.NODE_ENV = 'development'
        motion = undefined
    })

    afterEach(() => {
        jest.useRealTimers()
        resetTaskPostponeMotionRegistry()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const mount = async options => {
        let tree
        await act(async () => {
            tree = renderer.create(<Harness options={options} />)
            await Promise.resolve()
        })
        return tree
    }

    const postpone = async (overrides = {}, write = jest.fn()) => {
        let promise
        act(() => {
            promise = postponeTaskWithMotion(
                {
                    projectId: PROJECT,
                    task: TASK,
                    targetDate: Date.now() + 2 * 24 * 60 * 60 * 1000,
                    updatesDueDate: true,
                    ...overrides,
                },
                write
            )
        })
        return { promise, write }
    }

    it('recognises only dates beyond the end of the current day', () => {
        const now = new Date(2026, 8, 11, 9).valueOf()
        expect(targetLeavesToday(new Date(2026, 8, 11, 22).valueOf(), now)).toBe(false)
        expect(targetLeavesToday(new Date(2026, 8, 12, 0).valueOf(), now)).toBe(true)
        expect(targetLeavesToday(Number.MAX_SAFE_INTEGER, now)).toBe(true)
    })

    it('animates only the row with compositor styles before writing', async () => {
        const tree = await mount()
        const { promise, write } = await postpone()

        expect(POSTPONE_SLIDE_FADE_MS + POSTPONE_COLLAPSE_MS).toBe(POSTPONE_EXIT_TOTAL_MS)
        expect(POSTPONE_EXIT_TOTAL_MS).toBe(350)
        expect(POSTPONE_TRANSLATE_X).toBeLessThan(0)
        expect(motion.rowStyle).toEqual(expect.objectContaining({ opacity: expect.anything() }))
        expect(motion.rowStyle.transform[0].translateX).toBeDefined()
        expect(motion.rowStyle.transform[1].scaleY).toBeDefined()
        expect(motion.rowStyle.height).toBeUndefined()
        expect(motion.rowStyle.minHeight).toBeUndefined()
        expect(motion.rowStyle.marginBottom).toBeUndefined()
        expect(motion.rowStyle.overflow).toBeUndefined()
        expect(tree.root.findByProps({ testID: 'page' }).props.style).toBe(pageStyle)
        expect(tree.root.findByProps({ testID: 'header' }).props.style).toBe(headerStyle)
        expect(tree.root.findByProps({ testID: 'sibling-goal-section' }).props.style).toBe(siblingStyle)
        expect(tree.root.findByProps({ testID: 'entry-row' }).props.style).toBe(entryStyle)
        expect(write).not.toHaveBeenCalled()

        await act(async () => {
            jest.advanceTimersByTime(POSTPONE_EXIT_TOTAL_MS)
            await promise
        })
        expect(write).toHaveBeenCalledTimes(1)
    })

    it('does not hand a final task postpone to its goal section or other page elements', async () => {
        const tree = await mount({ goalId: TASK.parentGoalId })
        const { promise } = await postpone()

        expect(motion.rowStyle).toBeDefined()
        expect(tree.root.findByProps({ testID: 'page' }).props.style).toBe(pageStyle)
        expect(tree.root.findByProps({ testID: 'header' }).props.style).toBe(headerStyle)
        expect(tree.root.findByProps({ testID: 'sibling-goal-section' }).props.style).toBe(siblingStyle)
        expect(tree.root.findByProps({ testID: 'entry-row' }).props.style).toBe(entryStyle)

        await act(async () => {
            jest.advanceTimersByTime(POSTPONE_EXIT_TOTAL_MS)
            await promise
        })
    })

    it('does nothing for a date change that leaves the task in Today', async () => {
        await mount()
        const write = jest.fn()

        await act(async () => {
            await postponeTaskWithMotion(
                { projectId: PROJECT, task: TASK, targetDate: Date.now(), updatesDueDate: true },
                write
            )
        })

        expect(write).toHaveBeenCalledTimes(1)
        expect(motion.rowStyle).toBeUndefined()
    })

    it('does not animate an observed-only row when only the assignee date changes', async () => {
        await mount({ isObservedTask: true, isToReviewTask: false })
        const { promise, write } = await postpone({ updatesDueDate: true, updatesObservedDate: false })

        await act(async () => promise)
        expect(write).toHaveBeenCalledTimes(1)
        expect(motion.rowStyle).toBeUndefined()
    })

    it('uses a brief fade without translation or animated collapse for reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        const tree = await mount()
        const { promise, write } = await postpone()

        expect(motion.rowStyle.opacity).toBeDefined()
        expect(motion.rowStyle.transform).toBeUndefined()
        expect(motion.rowStyle.height).toBeUndefined()
        expect(motion.rowStyle.marginBottom).toBeUndefined()
        expect(tree.root.findByProps({ testID: 'page' }).props.style).toBe(pageStyle)
        expect(tree.root.findByProps({ testID: 'header' }).props.style).toBe(headerStyle)
        expect(tree.root.findByProps({ testID: 'sibling-goal-section' }).props.style).toBe(siblingStyle)
        expect(tree.root.findByProps({ testID: 'entry-row' }).props.style).toBe(entryStyle)

        await act(async () => {
            jest.advanceTimersByTime(POSTPONE_REDUCED_FADE_MS)
            await promise
        })
        expect(write).toHaveBeenCalledTimes(1)
    })

    it('restores the row when the postpone write fails', async () => {
        await mount()
        const error = new Error('write failed')
        const { promise } = await postpone(
            {},
            jest.fn(() => Promise.reject(error))
        )

        await act(async () => {
            jest.advanceTimersByTime(POSTPONE_EXIT_TOTAL_MS)
            await expect(promise).rejects.toBe(error)
        })
        expect(motion.rowStyle).toBeUndefined()
    })

    it('is inert when no eligible Today/My Day row registered the task', async () => {
        const write = jest.fn()
        await postponeTaskWithMotion(
            { projectId: PROJECT, task: TASK, targetDate: Number.MAX_SAFE_INTEGER, updatesDueDate: true },
            write
        )
        expect(write).toHaveBeenCalledTimes(1)
    })
})
