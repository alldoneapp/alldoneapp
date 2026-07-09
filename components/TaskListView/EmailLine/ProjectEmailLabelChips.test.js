/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ProjectEmailLabelChips from './ProjectEmailLabelChips'

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

const GROUPS = [
    { key: 'inbox', displayName: 'Inbox', isInbox: true, projectId: null, threadCount: 9, sweeping: false },
    { key: 'mk', displayName: 'Marketing', isInbox: false, projectId: 'proj_mk', threadCount: 3, sweeping: false },
    { key: 'ads', displayName: 'Ads', isInbox: false, projectId: null, threadCount: 2, sweeping: false },
    { key: 'empty', displayName: 'Empty', isInbox: false, projectId: 'proj_mk', threadCount: 0, sweeping: false },
]

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(<ProjectEmailLabelChips {...props} />)
    })
    return tree
}

const chipLabels = tree => tree.root.findAllByType(Text).map(node => node.props.children)

beforeEach(() => {
    useEmailLabelGroups.mockReturnValue({
        groups: GROUPS,
        labelOptionsByConnectionId: {},
        labelingDisabledByConnectionId: {},
    })
})

describe('ProjectEmailLabelChips', () => {
    test('renders only the project’s chip-worthy label', () => {
        expect(chipLabels(render({ projectId: 'proj_mk' }))).toEqual(['Marketing'])
    })

    test('renders nothing for a project with no mapped labels', () => {
        expect(render({ projectId: 'proj_none' }).toJSON()).toBeNull()
    })

    test('renders nothing without a projectId', () => {
        expect(render({}).toJSON()).toBeNull()
    })
})
