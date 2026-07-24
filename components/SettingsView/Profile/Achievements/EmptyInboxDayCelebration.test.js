import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo } from 'react-native'

import EmptyInboxDayCelebration from './EmptyInboxDayCelebration'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, values = {}) => `${key}${values.count ? ` ${values.count}` : ''}`,
}))

describe('EmptyInboxDayCelebration', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAnnounceForAccessibility = AccessibilityInfo.announceForAccessibility
    const originalAddEventListener = AccessibilityInfo.addEventListener

    beforeEach(() => {
        jest.useFakeTimers()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        AccessibilityInfo.announceForAccessibility = jest.fn()
        AccessibilityInfo.addEventListener = jest.fn()
    })

    afterEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.announceForAccessibility = originalAnnounceForAccessibility
        AccessibilityInfo.addEventListener = originalAddEventListener
        jest.useRealTimers()
    })

    it('shows a static, announced confirmation when reduced motion is enabled', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<EmptyInboxDayCelebration runId={0} currentStreak={3} />)
        })

        act(() => {
            tree.update(<EmptyInboxDayCelebration runId={1} currentStreak={4} />)
        })

        expect(tree.root.findByProps({ accessibilityLiveRegion: 'polite' }).props.accessibilityLabel).toBe(
            'Empty inbox streak day added 4'
        )
        expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Empty inbox streak day added 4')

        act(() => {
            jest.runOnlyPendingTimers()
        })
        expect(tree.root.findAllByProps({ accessibilityLiveRegion: 'polite' })).toHaveLength(0)
    })
})
