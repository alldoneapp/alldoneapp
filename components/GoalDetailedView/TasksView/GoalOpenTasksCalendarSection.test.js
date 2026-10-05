import React from 'react'
import renderer, { act } from 'react-test-renderer'
import GoalOpenTasksCalendarSection from './GoalOpenTasksCalendarSection'

jest.mock('react-redux', () => ({ useSelector: selector => selector({ loggedUser: { apisConnected: {} } }) }))
jest.mock('./GoalTasksList', () => 'GoalTasksList')
jest.mock('../../UIComponents/ReloadCalendar', () => 'ReloadCalendar')
jest.mock('../../../assets/svg/GoogleCalendar', () => 'GoogleCalendar')
jest.mock('../../UIComponents/FloatModals/PrepareMeetings/CalendarSectionMoreButton', () => 'CalendarSectionMoreButton')
jest.mock('../../../utils/backends/firestore', () => ({ checkIfCalendarConnected: jest.fn() }))
jest.mock('../../../utils/backends/Tasks/openGoalTasks', () => ({ CALENDAR_TASK_INDEX: 6 }))

it('restricts the goal heading action to the displayed goal meetings', () => {
    const tasks = [{ id: 'goal-meeting', calendarData: { start: { date: '2026-10-05' } } }]
    let tree
    act(() => {
        tree = renderer.create(<GoalOpenTasksCalendarSection projectId="project-1" calendarTasks={tasks} />)
    })
    expect(tree.root.findByType('CalendarSectionMoreButton').props).toEqual({ projectId: 'project-1', tasks })
    act(() => tree.unmount())
})
