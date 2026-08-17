import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskListSkeleton from './TaskListSkeleton'

jest.mock('../../i18n/TranslationService', () => ({
    translate: value => value,
}))

describe('TaskListSkeleton', () => {
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

    it('renders stable task-height rows and an optional date placeholder', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<TaskListSkeleton rowCount={4} showDateHeader taskKeys={['a', 'b', 'c', 'd']} />)
            await Promise.resolve()
        })

        expect(tree.root.findAllByProps({ testID: 'task-loading-skeleton-row' })).toHaveLength(4)
        expect(tree.root.findByProps({ testID: 'task-list-loading-skeleton' }).props.accessibilityRole).toBe(
            'progressbar'
        )
    })

    it('uses the compact three-row fallback before task counts are known', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<TaskListSkeleton />)
            await Promise.resolve()
        })

        expect(tree.root.findAllByProps({ testID: 'task-loading-skeleton-row' })).toHaveLength(3)
    })
})
