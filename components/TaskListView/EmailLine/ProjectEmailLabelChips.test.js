/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ProjectEmailLabelChips from './ProjectEmailLabelChips'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
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
const useSelector = require('react-redux').useSelector

const GROUPS = [
    { key: 'inbox', displayName: 'Inbox', isInbox: true, projectId: null, threadCount: 9, sweeping: false },
    { key: 'mk', displayName: 'Marketing', isInbox: false, projectId: 'proj_mk', threadCount: 3, sweeping: false },
    { key: 'ads', displayName: 'Ads', isInbox: false, projectId: null, threadCount: 2, sweeping: false },
    { key: 'empty', displayName: 'Empty', isInbox: false, projectId: 'proj_mk', threadCount: 0, sweeping: false },
]

const render = (props, state = { smallScreenNavigation: false, isMiddleScreen: false }) => {
    useSelector.mockImplementation(selector => selector(state))
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

    test.each([
        ['desktop', false, false, ['Marketing', 'Sales', 'Support']],
        ['tablet', false, true, ['Marketing', 'Sales']],
        ['mobile', true, true, ['Marketing']],
    ])('limits chips on %s', (_, smallScreenNavigation, isMiddleScreen, expectedLabels) => {
        useEmailLabelGroups.mockReturnValue({
            groups: [
                ...GROUPS,
                { key: 'sales', displayName: 'Sales', projectId: 'proj_mk', threadCount: 2 },
                { key: 'support', displayName: 'Support', projectId: 'proj_mk', threadCount: 4 },
                { key: 'billing', displayName: 'Billing', projectId: 'proj_mk', threadCount: 1 },
            ],
            labelOptionsByConnectionId: {},
            labelingDisabledByConnectionId: {},
        })

        const tree = render({ projectId: 'proj_mk' }, { smallScreenNavigation, isMiddleScreen })

        expect(chipLabels(tree)).toEqual(expectedLabels)
    })
})
