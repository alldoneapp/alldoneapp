import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, View } from 'react-native'

import useGoalPostponeMotion, { postponeGoalWithMotion, resetGoalPostponeMotionRegistry } from './goalPostponeMotion'
import {
    POSTPONE_EXIT_TOTAL_MS,
    POSTPONE_REDUCED_FADE_MS,
    POSTPONE_TRANSLATE_X,
} from '../TaskItem/TaskPresentation/taskPostponeMotion'

let motion
const PROJECT = 'project-1'
const GOAL = { id: 'goal-1' }
const pageStyle = { flex: 1 }
const headerStyle = { paddingTop: 8 }
const siblingStyle = { marginTop: 12 }
const entryStyle = { paddingBottom: 8 }

const Harness = ({ enabled = true }) => {
    motion = useGoalPostponeMotion({ enabled, projectId: PROJECT, goalId: GOAL.id })
    return (
        <View testID="page" style={pageStyle}>
            <View testID="header" style={headerStyle} />
            <View testID="goal" style={motion.sectionStyle} />
            <View testID="sibling-goal-section" style={siblingStyle} />
            <View testID="entry-row" style={entryStyle} />
        </View>
    )
}

describe('whole goal postpone motion (AT-2541)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        resetGoalPostponeMotionRegistry()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        process.env.NODE_ENV = 'development'
        motion = undefined
    })

    afterEach(() => {
        jest.useRealTimers()
        resetGoalPostponeMotionRegistry()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const mount = async (enabled = true) => {
        let tree
        await act(async () => {
            tree = renderer.create(<Harness enabled={enabled} />)
            await Promise.resolve()
        })
        return tree
    }

    const postpone = write => {
        let promise
        act(() => {
            promise = postponeGoalWithMotion(
                { projectId: PROJECT, goal: GOAL, targetDate: Date.now() + 2 * 24 * 60 * 60 * 1000 },
                write
            )
        })
        return promise
    }

    it('animates only the complete goal section with compositor styles before writing', async () => {
        const tree = await mount(true)
        const write = jest.fn()
        const promise = postpone(write)

        expect(POSTPONE_TRANSLATE_X).toBeLessThan(0)
        expect(motion.sectionStyle).toEqual(
            expect.objectContaining({
                opacity: expect.anything(),
                pointerEvents: 'none',
            })
        )
        expect(motion.sectionStyle.transform[0].translateX).toBeDefined()
        expect(motion.sectionStyle.transform[1].scaleY).toBeDefined()
        expect(motion.sectionStyle.height).toBeUndefined()
        expect(motion.sectionStyle.minHeight).toBeUndefined()
        expect(motion.sectionStyle.marginBottom).toBeUndefined()
        expect(motion.sectionStyle.overflow).toBeUndefined()
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

    it('does not animate a goal date change that stays in Today', async () => {
        await mount()
        const write = jest.fn()

        await act(async () => {
            await postponeGoalWithMotion({ projectId: PROJECT, goal: GOAL, targetDate: Date.now() }, write)
        })

        expect(write).toHaveBeenCalledTimes(1)
        expect(motion.sectionStyle).toBeUndefined()
    })

    it('uses only a brief fade under reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        const tree = await mount()
        const write = jest.fn()
        const promise = postpone(write)

        expect(motion.sectionStyle.opacity).toBeDefined()
        expect(motion.sectionStyle.transform).toBeUndefined()
        expect(motion.sectionStyle.height).toBeUndefined()
        expect(motion.sectionStyle.marginBottom).toBeUndefined()
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

    it('restores the complete section when its write fails', async () => {
        await mount()
        const error = new Error('write failed')
        const promise = postpone(jest.fn(() => Promise.reject(error)))

        await act(async () => {
            jest.advanceTimersByTime(POSTPONE_EXIT_TOTAL_MS)
            await expect(promise).rejects.toBe(error)
        })
        expect(motion.sectionStyle).toBeUndefined()
    })

    it('writes immediately when no eligible Today section is registered', async () => {
        await mount(false)
        const write = jest.fn()

        await postponeGoalWithMotion({ projectId: PROJECT, goal: GOAL, targetDate: Number.MAX_SAFE_INTEGER }, write)

        expect(write).toHaveBeenCalledTimes(1)
        expect(motion.sectionStyle).toBeUndefined()
    })
})
