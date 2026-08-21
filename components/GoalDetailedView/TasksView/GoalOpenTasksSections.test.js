import React from 'react'
import renderer, { act } from 'react-test-renderer'

import GoalOpenTasksSections from './GoalOpenTasksSections'

let mockState
let mockHashtagMatch

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => jest.fn(),
}))
jest.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }) => children,
}))
jest.mock('./GoalOpenTasksMainSection', () => 'GoalOpenTasksMainSection')
jest.mock('./GoalOpenTasksMentionSection', () => 'GoalOpenTasksMentionSection')
jest.mock('./OpenGoalTasksSuggestedSectionList', () => 'OpenGoalTasksSuggestedSectionList')
jest.mock('./GoalOpenTasksCalendarSection', () => 'GoalOpenTasksCalendarSection')
jest.mock('../../../redux/actions', () => ({
    removeActiveDragTaskModeInDate: jest.fn(),
    setSelectedTasks: jest.fn(),
}))
jest.mock('../../HashtagFilters/FilterHelpers/FilterTasks', () => ({
    taskMatchHashtagFilters: task => mockHashtagMatch(task),
}))
// The real module pulls in firestore.js, which needs the build-injected .env.
jest.mock('../../../utils/backends/Tasks/openGoalTasks', () => ({
    DATE_TASK_INDEX: 0,
    AMOUNT_TASKS_INDEX: 1,
    ESTIMATION_TASKS_INDEX: 2,
    MAIN_TASK_INDEX: 3,
    MENTION_TASK_INDEX: 4,
    SUGGESTED_TASK_INDEX: 5,
    CALENDAR_TASK_INDEX: 6,
}))

// AT-2377 - a goal's task list has its own Calendar section again. An inbox-summary EMAIL task
// deliberately keeps arriving inside the main section: its old bucket rendered nowhere on the
// open-tasks board, so giving it one back would hide it outside a goal.
describe('GoalOpenTasksSections', () => {
    const calendarTask = { id: 'calendar-task-1', calendarData: { eventId: 'event-1' } }
    const emailTask = { id: 'email-task-1', gmailData: { messageId: 'message-1' } }

    const renderSections = tasksData => {
        let tree
        act(() => {
            tree = renderer.create(
                <GoalOpenTasksSections
                    tasksData={tasksData}
                    projectId="project-1"
                    dateIndex={0}
                    goal={{ id: 'goal-1' }}
                />
            )
        })
        return tree
    }

    beforeEach(() => {
        mockState = { activeDragTaskModeInDate: null, hashtagFilters: new Map() }
        mockHashtagMatch = () => true
    })

    it('renders the calendar section for a day holding calendar tasks', () => {
        const tasksData = ['20260811', 2, 0, [{ id: 'task-1' }], [], [], [calendarTask]]

        const tree = renderSections(tasksData)

        expect(tree.root.findAllByType('GoalOpenTasksMainSection')).toHaveLength(1)
        expect(tree.root.findByType('GoalOpenTasksCalendarSection').props.calendarTasks).toEqual([calendarTask])
    })

    it('renders no calendar section when the day has no calendar tasks', () => {
        const tasksData = ['20260811', 1, 0, [{ id: 'task-1' }], [], [], []]

        const tree = renderSections(tasksData)

        expect(tree.root.findAllByType('GoalOpenTasksCalendarSection')).toHaveLength(0)
    })

    it('tolerates a day tuple that predates the calendar bucket', () => {
        const tasksData = ['20260811', 1, 0, [{ id: 'task-1' }], [], []]

        const tree = renderSections(tasksData)

        expect(tree.root.findAllByType('GoalOpenTasksCalendarSection')).toHaveLength(0)
    })

    it('renders no calendar header when a hashtag filter excludes every meeting', () => {
        mockHashtagMatch = task => !task.calendarData
        const tasksData = ['20260811', 2, 0, [{ id: 'task-1' }], [], [], [calendarTask]]

        const tree = renderSections(tasksData)

        expect(tree.root.findAllByType('GoalOpenTasksCalendarSection')).toHaveLength(0)
    })

    it('keeps an inbox summary email task in the main section', () => {
        const tasksData = ['20260811', 1, 0, [emailTask], [], [], []]

        const tree = renderSections(tasksData)
        const mainSection = tree.root.findByType('GoalOpenTasksMainSection')

        expect(mainSection.props.mainTasks).toEqual([emailTask])
        expect(tree.root.findAllByType('GoalOpenTasksEmailSection')).toHaveLength(0)
    })
})
