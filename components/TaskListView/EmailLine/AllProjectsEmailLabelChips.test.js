/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AllProjectsEmailLabelChips from './AllProjectsEmailLabelChips'

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

const render = (groups, { mobile = false, tablet = false } = {}) => {
    useSelector.mockImplementation(selector => selector({ smallScreenNavigation: mobile, isMiddleScreen: tablet }))
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
    test('renders the Inbox aggregate + unassigned labels, never project labels', () => {
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
        expect(chipLabels(tree)).toEqual(['Inbox', 'Ads', 'No label'])
    })

    test('renders only Inbox on mobile', () => {
        const tree = render(
            [
                {
                    key: 'inbox',
                    displayName: 'Inbox',
                    isInbox: true,
                    projectId: null,
                    threadCount: 9,
                    sweeping: false,
                },
                { key: 'ads', displayName: 'Ads', isInbox: false, projectId: null, threadCount: 2, sweeping: false },
                {
                    key: 'no',
                    displayName: 'No label',
                    isInbox: false,
                    projectId: null,
                    threadCount: 4,
                    sweeping: false,
                },
            ],
            { mobile: true, tablet: true }
        )
        expect(chipLabels(tree)).toEqual(['Inbox'])
    })

    test('limits unassigned chips on tablet', () => {
        const tree = render(
            [
                { key: 'inbox', displayName: 'Inbox', isInbox: true, threadCount: 9 },
                { key: 'ads', displayName: 'Ads', isInbox: false, threadCount: 2 },
                { key: 'news', displayName: 'News', isInbox: false, threadCount: 4 },
            ],
            { tablet: true }
        )

        expect(chipLabels(tree)).toEqual(['Inbox', 'Ads'])
    })

    test('limits unassigned chips on desktop', () => {
        const tree = render([
            { key: 'inbox', displayName: 'Inbox', isInbox: true, threadCount: 9 },
            { key: 'ads', displayName: 'Ads', isInbox: false, threadCount: 2 },
            { key: 'news', displayName: 'News', isInbox: false, threadCount: 4 },
            { key: 'sales', displayName: 'Sales', isInbox: false, threadCount: 1 },
        ])

        expect(chipLabels(tree)).toEqual(['Inbox', 'Ads', 'News'])
    })

    test('renders nothing at inbox zero when every label maps to a project', () => {
        const tree = render([
            { key: 'inbox', displayName: 'Inbox', isInbox: true, projectId: null, threadCount: 0, sweeping: false },
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
