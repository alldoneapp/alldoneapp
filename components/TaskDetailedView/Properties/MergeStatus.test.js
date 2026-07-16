import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import MergeStatus from './MergeStatus'
import { openMergeRequest } from '../../Tags/MergeStatusTag'

jest.mock('../../styles/global', () => ({
    __esModule: true,
    default: { subtitle2: {} },
    colors: {
        UtilityViolet125: '#DBC7FF',
        Violet300: '#702EE6',
        Text03: '#8A94A6',
    },
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: value => value }))
jest.mock('../../Tags/MergeStatusTag', () => ({ openMergeRequest: jest.fn() }))
jest.mock('../../Icon', () => 'Icon')

describe('task merge status property', () => {
    afterEach(() => jest.clearAllMocks())

    test('shows the normalized status and opens the provider URL', () => {
        const url = 'https://github.com/alldone/app/pull/4'
        const tree = renderer.create(<MergeStatus mergeRequest={{ status: 'ready_to_merge', url }} />)

        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual([
            'Merge status',
            'Ready to merge',
        ])
        act(() => tree.root.findByType(TouchableOpacity).props.onPress())
        expect(openMergeRequest).toHaveBeenCalledWith(url)
    })

    test('does not show an empty property without a VM merge status', () => {
        const tree = renderer.create(<MergeStatus mergeRequest={null} />)
        expect(tree.root.findAllByType(Text)).toHaveLength(0)
    })
})
