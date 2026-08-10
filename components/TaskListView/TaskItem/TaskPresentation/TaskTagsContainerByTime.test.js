import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import TaskTagsContainerByTime from './TaskTagsContainerByTime'

let mockTaskViewToggleSection = 'Open'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ taskViewToggleSection: mockTaskViewToggleSection }),
}))
jest.mock('../../TaskItemTags', () => () => null)
jest.mock('../../../Tags/TimeTagWrapper', () => () => {
    const { Text } = require('react-native')
    return <Text>time</Text>
})
jest.mock('../../../Tags/CompletedTimeTag', () => () => {
    const { Text } = require('react-native')
    return <Text>completed time</Text>
})
jest.mock('../../../Tags/CalendarTag', () => () => {
    const { Text } = require('react-native')
    return <Text>calendar</Text>
})
jest.mock('../../TagsArea/Tags', () => () => null)
jest.mock('../../Utils/TasksHelper', () => ({ shouldOnPressInput: jest.fn(() => true) }))

describe('TaskTagsContainerByTime', () => {
    beforeEach(() => {
        mockTaskViewToggleSection = 'Open'
    })

    test('renders the VM status before time and priority in the by-time layout', () => {
        const tree = renderer.create(
            <TaskTagsContainerByTime
                task={{ id: 'task-1', time: '09:00' }}
                projectId="project-1"
                highlightColor="#FFFFFF"
                setTagsExpandedHeight={jest.fn()}
                leadingVmStatusTag={<Text>VM status</Text>}
                leadingPriorityTag={<Text>priority</Text>}
            />
        )

        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual([
            'VM status',
            'time',
            'priority',
        ])
    })

    test('keeps the calendar tag instead of the completed time tag for a done calendar task', () => {
        mockTaskViewToggleSection = 'Done'

        const tree = renderer.create(
            <TaskTagsContainerByTime
                task={{
                    id: 'task-1',
                    calendarData: { eventId: 'event-1' },
                    done: true,
                    inDone: true,
                    completedTime: { startTime: 1786034078902, endTime: 1786037678902 },
                }}
                projectId="project-1"
                highlightColor="#FFFFFF"
                setTagsExpandedHeight={jest.fn()}
            />
        )

        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual(['calendar'])
    })

    test('still renders the completed time tag for a done task without calendar data', () => {
        mockTaskViewToggleSection = 'Done'

        const tree = renderer.create(
            <TaskTagsContainerByTime
                task={{
                    id: 'task-1',
                    done: true,
                    inDone: true,
                    completedTime: { startTime: 1786034078902, endTime: 1786037678902 },
                }}
                projectId="project-1"
                highlightColor="#FFFFFF"
                setTagsExpandedHeight={jest.fn()}
            />
        )

        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual(['completed time'])
    })

    test('renders the calendar tag for an open calendar task', () => {
        const tree = renderer.create(
            <TaskTagsContainerByTime
                task={{ id: 'task-1', calendarData: { eventId: 'event-1' } }}
                projectId="project-1"
                highlightColor="#FFFFFF"
                setTagsExpandedHeight={jest.fn()}
            />
        )

        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual(['calendar'])
    })
})
