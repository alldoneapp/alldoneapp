import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import MergeStatusTag from './MergeStatusTag'

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
        expect(tree.root.findByProps({ accessibilityLabel: label }).props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ backgroundColor: '#DBC7FF' })])
        )
    })

    test.each([null, {}, { url: 'https://example.com' }, { status: 'unknown', url: 'https://example.com' }])(
        'does not render an empty/unknown status for %j',
        mergeRequest => {
            const tree = renderer.create(<MergeStatusTag mergeRequest={mergeRequest} />)
            expect(tree.root.findAllByType(Text)).toHaveLength(0)
        }
    )
})
