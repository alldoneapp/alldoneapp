import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo, View } from 'react-native'

import {
    GENERAL_TASK_ENTRY_EXPAND_DELAY_MS,
    GENERAL_TASK_ENTRY_EXPAND_MS,
    GENERAL_TASK_ENTRY_FADE_DELAY_MS,
    GENERAL_TASK_ENTRY_FADE_MS,
    GENERAL_TASK_ENTRY_TOTAL_MS,
    useGeneralTaskSectionEntry,
} from './GeneralTaskSectionEntry'
import { GOAL_EXIT_COLLAPSE_DELAY_MS, GOAL_EXIT_FADE_MS, GOAL_SECTION_EXIT_TOTAL_MS } from './goalSectionExitMotion'

let motion
const Harness = ({ entryRunId }) => {
    motion = useGeneralTaskSectionEntry(entryRunId)
    return (
        <View style={motion.sectionStyle}>
            <View onLayout={motion.onContentLayout} style={motion.contentStyle} />
        </View>
    )
}

const layout = height => ({ nativeEvent: { layout: { height } } })

describe('the general add-task row replacing a completed goal (AT-2534)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        motion = undefined
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const render = async entryRunId => {
        let tree
        await act(async () => {
            tree = renderer.create(<Harness entryRunId={entryRunId} />)
            await Promise.resolve()
        })
        return tree
    }

    it('leaves an ordinary empty-list row completely untouched', async () => {
        await render(0)

        expect(motion.entering).toBe(false)
        expect(motion.sectionStyle).toBeUndefined()
        expect(motion.contentStyle).toBeUndefined()
    })

    it('mounts a replacement at zero height and blocks it from interaction', async () => {
        await render(1)

        expect(motion.entering).toBe(true)
        expect(motion.sectionStyle.height).toBeDefined()
        expect(motion.sectionStyle.overflow).toBe('hidden')
        expect(motion.sectionStyle.pointerEvents).toBe('none')
        expect(motion.contentStyle.opacity).toBeDefined()
        expect(motion.contentStyle.transform[0].translateY).toBeDefined()
    })

    it('settles back to the ordinary interactive row after its measured height has opened', async () => {
        await render(1)
        await act(async () => motion.onContentLayout(layout(42)))

        await act(async () => {
            jest.advanceTimersByTime(GENERAL_TASK_ENTRY_TOTAL_MS)
        })

        expect(motion.entering).toBe(false)
        expect(motion.sectionStyle).toBeUndefined()
        expect(motion.contentStyle).toBeUndefined()
    })

    it('does not replay the same run after settling', async () => {
        const tree = await render(1)
        await act(async () => motion.onContentLayout(layout(42)))
        await act(async () => jest.advanceTimersByTime(GENERAL_TASK_ENTRY_TOTAL_MS))

        await act(async () => {
            tree.update(<Harness entryRunId={1} />)
        })

        expect(motion.entering).toBe(false)
    })

    it('stands down under reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        await render(1)

        expect(motion.entering).toBe(false)
        expect(motion.sectionStyle).toBeUndefined()
        expect(motion.contentStyle).toBeUndefined()
    })

    it('shares the goal collapse beat and finishes before the goal exit releases', () => {
        expect(GENERAL_TASK_ENTRY_EXPAND_DELAY_MS).toBe(GOAL_EXIT_COLLAPSE_DELAY_MS)
        expect(GENERAL_TASK_ENTRY_EXPAND_DELAY_MS + GENERAL_TASK_ENTRY_EXPAND_MS).toBe(GOAL_EXIT_FADE_MS)
        expect(GENERAL_TASK_ENTRY_FADE_DELAY_MS).toBeGreaterThan(GENERAL_TASK_ENTRY_EXPAND_DELAY_MS)
        expect(GENERAL_TASK_ENTRY_FADE_DELAY_MS + GENERAL_TASK_ENTRY_FADE_MS).toBeLessThanOrEqual(
            GENERAL_TASK_ENTRY_TOTAL_MS
        )
        expect(GENERAL_TASK_ENTRY_TOTAL_MS).toBeLessThan(GOAL_SECTION_EXIT_TOTAL_MS)
    })
})
