import React from 'react'
import renderer, { act } from 'react-test-renderer'

import TasksSections from './TasksSections'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }) => children,
}))
jest.mock('../../../redux/store', () => ({
    getState: jest.fn(() => ({})),
}))
jest.mock('../../DragSystem/DragHelper', () => ({
    onBeforeCapture: jest.fn(),
    onDragEnd: jest.fn(),
}))
jest.mock('./MainSection', () => 'MainSection')
jest.mock('./MentionSection', () => 'MentionSection')
jest.mock('./SuggestedSectionList', () => 'SuggestedSectionList')
jest.mock('./OriginallyFromSectionList', () => 'OriginallyFromSectionList')
jest.mock('./ObservedFromSectionList', () => 'ObservedFromSectionList')
jest.mock('./StreamAndUserTasksSectionList', () => 'StreamAndUserTasksSectionList')
jest.mock('./CalendarSectionContainer', () => 'CalendarSectionContainer')
// The real module pulls in firestore.js, which needs the build-injected .env. Only the bucket
// indexes matter here, so stub them the way taskPriorityFilterHelper.test.js does.
jest.mock('../../../utils/backends/openTasks', () => ({
    MENTION_TASK_INDEX: 4,
    SUGGESTED_TASK_INDEX: 5,
    WORKFLOW_TASK_INDEX: 6,
    OBSERVED_TASKS_INDEX: 7,
    STREAM_AND_USER_TASKS_INDEX: 8,
    CALENDAR_TASK_INDEX: 10,
}))

describe('TasksSections assistant profile workflow tasks', () => {
    beforeEach(() => {
        const tasksByType = Array.from({ length: 11 }, () => [])
        tasksByType[6] = [['workflow-step-1', []]]
        mockState = {
            filteredOpenTasksStore: {
                instance: [tasksByType],
            },
        }
    })

    it('shows received workflow tasks in the assistant Open tab', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <TasksSections
                    projectId="project-1"
                    dateIndex={0}
                    projectIndex={0}
                    instanceKey="instance"
                    assistantProfileMode
                />
            )
        })

        expect(tree.root.findAllByType('OriginallyFromSectionList')).toHaveLength(1)
    })
})

// AT-2377 - calendar tasks get their own section back. Email tasks deliberately do not: their old
// bucket rendered nowhere on this board, so they stay inside MainSection.
describe('TasksSections calendar section', () => {
    const renderSections = extraProps => {
        let tree
        act(() => {
            tree = renderer.create(
                <TasksSections
                    projectId="project-1"
                    dateIndex={0}
                    projectIndex={0}
                    instanceKey="instance"
                    {...extraProps}
                />
            )
        })
        return tree
    }

    const setCalendarTasks = calendarTasksByGoal => {
        const tasksByType = Array.from({ length: 12 }, () => [])
        tasksByType[10] = calendarTasksByGoal
        mockState = { filteredOpenTasksStore: { instance: [tasksByType] } }
    }

    it('renders a dedicated calendar section when the day has calendar tasks', () => {
        setCalendarTasks([['0', [{ id: 'task-1' }]]])

        const tree = renderSections()

        expect(tree.root.findAllByType('CalendarSectionContainer')).toHaveLength(1)
        expect(tree.root.findAllByType('MainSection')).toHaveLength(1)
    })

    it('renders no calendar section on a day without calendar tasks', () => {
        setCalendarTasks([])

        const tree = renderSections()

        expect(tree.root.findAllByType('CalendarSectionContainer')).toHaveLength(0)
        expect(tree.root.findAllByType('MainSection')).toHaveLength(1)
    })

    it('keeps the calendar section out of the assistant profile timeline', () => {
        setCalendarTasks([['0', [{ id: 'task-1' }]]])

        const tree = renderSections({ assistantProfileMode: true })

        expect(tree.root.findAllByType('CalendarSectionContainer')).toHaveLength(0)
    })

    it('never renders a dedicated email section', () => {
        setCalendarTasks([])

        const tree = renderSections()

        expect(tree.root.findAllByType('EmailSection')).toHaveLength(0)
    })
})
