import React from 'react'
import { Platform, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import MergeStatusTag, { openMergeRequest } from './MergeStatusTag'

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: {
        UtilityViolet125: '#DBC7FF',
        Violet300: '#702EE6',
    },
    windowTagStyle: jest.fn(() => undefined),
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))

describe('MergeStatusTag', () => {
    const originalPlatform = Platform.OS

    afterEach(() => {
        Platform.OS = originalPlatform
        jest.restoreAllMocks()
    })

    test.each([
        ['draft', 'Draft'],
        ['checks_running', 'Checks running'],
        ['needs_approval', 'Needs approval'],
        ['blocked', 'Blocked'],
        ['ready_to_merge', 'Ready to merge'],
        ['merged', 'Merged'],
        ['closed', 'Closed'],
    ])('renders %s using the dedicated merge color', (status, label) => {
        const tree = renderer.create(
            <MergeStatusTag
                mergeRequest={{ status, url: 'https://gitlab.example.com/group/repo/-/merge_requests/1' }}
            />
        )
        expect(tree.root.findByType(Text).props.children).toBe(label)
        expect(tree.root.findByType(TouchableOpacity).props).toEqual(
            expect.objectContaining({
                accessible: true,
                accessibilityLabel: `Merge status: ${label}`,
                accessibilityRole: 'link',
            })
        )
        const coloredTag = tree.root.findAll(
            node =>
                Array.isArray(node.props.style) && node.props.style.some(style => style?.backgroundColor === '#DBC7FF')
        )
        expect(coloredTag.length).toBeGreaterThan(0)
    })

    test('opens the exact backend URL safely without triggering the task row', () => {
        Platform.OS = 'web'
        const url = 'https://github.com/alldone/app/pull/17?notification_referrer_id=exact'
        const openedWindow = { opener: window }
        const windowOpen = jest.spyOn(window, 'open').mockReturnValue(openedWindow)
        const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() }
        const tree = renderer.create(<MergeStatusTag mergeRequest={{ status: 'checks_running', url }} />)

        act(() => tree.root.findByType(TouchableOpacity).props.onPress(event))

        expect(event.preventDefault).toHaveBeenCalledTimes(1)
        expect(event.stopPropagation).toHaveBeenCalledTimes(1)
        expect(windowOpen).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
        expect(openedWindow.opener).toBeNull()
    })

    test('does not open non-web external URLs', () => {
        Platform.OS = 'web'
        const windowOpen = jest.spyOn(window, 'open').mockReturnValue(null)

        openMergeRequest('javascript:alert(1)')

        expect(windowOpen).not.toHaveBeenCalled()
    })

    test.each([null, {}, { url: 'https://example.com' }, { status: 'unknown', url: 'https://example.com' }])(
        'does not render an empty/unknown status for %j',
        mergeRequest => {
            const tree = renderer.create(<MergeStatusTag mergeRequest={mergeRequest} />)
            expect(tree.root.findAllByType(Text)).toHaveLength(0)
        }
    )
})
