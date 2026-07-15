import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import LeftTagsAndIcons from './LeftTagsAndIcons'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../GoalsView/MilestoneDateTag', () => () => {
    const { Text } = require('react-native')
    return <Text>milestone date</Text>
})
jest.mock('../../GoalsView/DoneStateWrapper', () => () => {
    const { Text } = require('react-native')
    return <Text>done state</Text>
})
jest.mock('../../Tags/TimeTagWrapper', () => () => {
    const { Text } = require('react-native')
    return <Text>time</Text>
})
jest.mock('../../Tags/CompletedTimeTag', () => () => {
    const { Text } = require('react-native')
    return <Text>completed time</Text>
})
jest.mock('../../Tags/CalendarTag', () => () => {
    const { Text } = require('react-native')
    return <Text>calendar</Text>
})

describe('LeftTagsAndIcons', () => {
    test('renders a leading status before calendar and custom tags', () => {
        const tree = renderer.create(
            <LeftTagsAndIcons
                task={{ calendarData: { eventId: 'event-1' } }}
                leadingStatusElement={<Text>VM status</Text>}
                leftCustomElement={<Text>priority</Text>}
            />
        )

        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual([
            'VM status',
            'calendar',
            'priority',
        ])
    })
})
