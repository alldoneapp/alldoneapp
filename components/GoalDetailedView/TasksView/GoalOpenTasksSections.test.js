import React from 'react'
import renderer, { act } from 'react-test-renderer'

import GoalOpenTasksSections from './GoalOpenTasksSections'

let mockState

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
jest.mock('../../../redux/actions', () => ({
    removeActiveDragTaskModeInDate: jest.fn(),
    setSelectedTasks: jest.fn(),
}))
jest.mock('../../HashtagFilters/FilterHelpers/FilterTasks', () => ({
    taskMatchHashtagFilters: () => true,
}))
// The real module pulls in firestore.js, which needs the build-injected .env.
jest.mock('../../../utils/backends/Tasks/openGoalTasks', () => ({
    DATE_TASK_INDEX: 0,
    AMOUNT_TASKS_INDEX: 1,
    ESTIMATION_TASKS_INDEX: 2,
    MAIN_TASK_INDEX: 3,
    MENTION_TASK_INDEX: 4,
    SUGGESTED_TASK_INDEX: 5,
}))

// AT-2252 - a goal's task list no longer has "Google Calendar" and "Email" sections. Those tasks
// arrive inside the main section like every other task.
describe('GoalOpenTasksSections', () => {
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
    })

    it('renders only the main, mention and suggested sections', () => {
        const calendarTask = { id: 'calendar-task-1', calendarData: { eventId: 'event-1' } }
        const emailTask = { id: 'email-task-1', gmailData: { messageId: 'message-1' } }
        // Calendar and email tasks now sit in the main bucket, so the day tuple ends at SUGGESTED.
        const tasksData = ['20260811', 3, 0, [calendarTask, emailTask, { id: 'task-1' }], [], []]

        const tree = renderSections(tasksData)

        expect(tree.root.findAllByType('GoalOpenTasksMainSection')).toHaveLength(1)
        expect(tree.root.findAllByType('GoalOpenTasksCalendarSection')).toHaveLength(0)
        expect(tree.root.findAllByType('GoalOpenTasksEmailSection')).toHaveLength(0)
    })

    it('passes calendar and email tasks through to the main section', () => {
        const calendarTask = { id: 'calendar-task-1', calendarData: { eventId: 'event-1' } }
        const emailTask = { id: 'email-task-1', gmailData: { messageId: 'message-1' } }
        const tasksData = ['20260811', 2, 0, [calendarTask, emailTask], [], []]

        const tree = renderSections(tasksData)
        const mainSection = tree.root.findByType('GoalOpenTasksMainSection')

        expect(mainSection.props.mainTasks).toEqual([calendarTask, emailTask])
    })
})
