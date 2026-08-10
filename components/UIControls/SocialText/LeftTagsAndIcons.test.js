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

    test('keeps the calendar tag on a done calendar task so it still looks like a calendar task', () => {
        const tree = renderer.create(
            <LeftTagsAndIcons
                task={{
                    calendarData: { eventId: 'event-1' },
                    done: true,
                    inDone: true,
                    completedTime: { startTime: 1786034078902, endTime: 1786037678902 },
                }}
            />
        )

        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual(['calendar'])
    })

    test('does not render the calendar tag for a done task without calendar data', () => {
        const tree = renderer.create(
            <LeftTagsAndIcons
                task={{ done: true, inDone: true, completedTime: { startTime: 1786034078902, endTime: 1786037678902 } }}
            />
        )

        expect(tree.root.findAllByType(Text)).toHaveLength(0)
    })

    test('leaves the calendar tag to the by-time layout when the calendar style is active', () => {
        const tree = renderer.create(
            <LeftTagsAndIcons
                task={{
                    calendarData: { eventId: 'event-1' },
                    done: true,
                    completedTime: { startTime: 1786034078902, endTime: 1786037678902 },
                }}
                activeCalendarStyle={true}
            />
        )

        expect(tree.root.findAllByType(Text)).toHaveLength(0)
    })
})
