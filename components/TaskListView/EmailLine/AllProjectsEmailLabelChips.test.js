/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AllProjectsEmailLabelChips from './AllProjectsEmailLabelChips'

jest.mock('./useEmailLabelGroups', () => ({ __esModule: true, default: jest.fn() }))

jest.mock('./EmailLabelChip', () => ({
    __esModule: true,
    default: ({ group }) => {
        const React = require('react')
        const { Text, View } = require('react-native')
        return (
            <View testID="chip">
                <Text>{group.displayName}</Text>
            </View>
        )
    },
}))

const useEmailLabelGroups = require('./useEmailLabelGroups').default

const render = groups => {
    useEmailLabelGroups.mockReturnValue({
        groups,
        labelOptionsByConnectionId: {},
        labelingDisabledByConnectionId: {},
    })
    let tree
    act(() => {
        tree = renderer.create(<AllProjectsEmailLabelChips />)
    })
    return tree
}

const chipLabels = tree => tree.root.findAllByType(Text).map(node => node.props.children)

describe('AllProjectsEmailLabelChips', () => {
    test('renders only unassigned chip-worthy labels, never Inbox or project labels', () => {
        const tree = render([
            { key: 'inbox', displayName: 'Inbox', isInbox: true, projectId: null, threadCount: 9, sweeping: false },
            {
                key: 'mk',
                displayName: 'Marketing',
                isInbox: false,
                projectId: 'proj_mk',
                threadCount: 3,
                sweeping: false,
            },
            { key: 'ads', displayName: 'Ads', isInbox: false, projectId: null, threadCount: 2, sweeping: false },
            { key: 'no', displayName: 'No label', isInbox: false, projectId: null, threadCount: 4, sweeping: false },
        ])
        expect(chipLabels(tree)).toEqual(['Ads', 'No label'])
    })

    test('renders nothing when every label maps to a project', () => {
        const tree = render([
            { key: 'inbox', displayName: 'Inbox', isInbox: true, projectId: null, threadCount: 9, sweeping: false },
            {
                key: 'mk',
                displayName: 'Marketing',
                isInbox: false,
                projectId: 'proj_mk',
                threadCount: 3,
                sweeping: false,
            },
        ])
        expect(tree.toJSON()).toBeNull()
    })
})
