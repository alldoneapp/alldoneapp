import React from 'react'
import renderer, { act } from 'react-test-renderer'

import CalendarSection from './CalendarSection'

let mockState
const mockSortGoalTasksGorups = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('./TasksList', () => 'TasksList')
jest.mock('./ParentGoalSection', () => 'ParentGoalSection')
jest.mock('./SwipeableGeneralTasksHeader', () => 'SwipeableGeneralTasksHeader')
jest.mock('../../UIComponents/ReloadCalendar', () => 'ReloadCalendar')
jest.mock('../../../assets/svg/GoogleCalendar', () => 'GoogleCalendar')
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
// The real module pulls in firestore.js, which needs the build-injected .env.
jest.mock('../../../utils/backends/firestore', () => ({ checkIfCalendarConnected: jest.fn() }))
jest.mock('../../../utils/backends/openTasks', () => ({
    CALENDAR_TASK_INDEX: 10,
    NOT_PARENT_GOAL_INDEX: '0',
    sortGoalTasksGorups: (...args) => mockSortGoalTasksGorups(...args),
}))

const GENERAL_TASKS = '0'

// react-native-web renders <Text> as a DOM element, so the rendered type is not 'Text'. Collect the
// literal strings out of the rendered tree instead.
const renderedText = node => {
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string') return [node]
    if (Array.isArray(node)) return node.flatMap(renderedText)
    return renderedText(node.children)
}

const meeting = (id, start) => ({ id, calendarData: { email: 'karsten@alldone.app', start } })
const timed = (id, isoStart) => meeting(id, { dateTime: isoStart })
const allDay = (id, day) => meeting(id, { date: day })

// AT-2377 - the dedicated Calendar section on the open-tasks board, removed by AT-2252.
describe('CalendarSection', () => {
    const renderSection = calendarEvents => {
        let tree
        act(() => {
            tree = renderer.create(
                <CalendarSection
                    projectId="project-1"
                    calendarEvents={calendarEvents}
                    dateIndex={0}
                    instanceKey="instance"
                    isActiveOrganizeMode={false}
                />
            )
        })
        return tree
    }

    beforeEach(() => {
        mockState = {
            loggedUser: { apisConnected: { 'project-1': { calendar: true, calendarEmail: 'karsten@alldone.app' } } },
            openMilestonesByProjectInTasks: {},
            doneMilestonesByProjectInTasks: {},
            goalsByProjectInTasks: {},
            currentUser: { uid: 'user-1' },
        }
        mockSortGoalTasksGorups.mockReturnValue({ [GENERAL_TASKS]: 0, 'goal-1': 1 })
    })

    it('shows a header naming the calendar provider', () => {
        const tree = renderSection([[GENERAL_TASKS, [timed('a', '2026-08-21T09:00:00+02:00')]]])

        expect(renderedText(tree.toJSON())).toContain('Google Calendar')
    })

    it('names Outlook when the events come from a Microsoft calendar', () => {
        const microsoftMeeting = {
            id: 'a',
            calendarData: { provider: 'microsoft', start: { dateTime: '2026-08-21T09:00:00+02:00' } },
        }
        const tree = renderSection([[GENERAL_TASKS, [microsoftMeeting]]])

        expect(renderedText(tree.toJSON())).toContain('Outlook Calendar')
    })

    // Meetings are ordered by the clock, not by priority or by `sortIndex`.
    it('orders the meetings of a group chronologically, all-day first', () => {
        const tree = renderSection([
            [
                GENERAL_TASKS,
                [
                    timed('noon', '2026-08-21T12:00:00+02:00'),
                    allDay('all-day', '2026-08-21'),
                    timed('nine', '2026-08-21T09:00:00+02:00'),
                ],
            ],
        ])

        const taskList = tree.root.findByType('TasksList')
        expect(taskList.props.taskList.map(task => task.id)).toEqual(['all-day', 'nine', 'noon'])
    })

    it('orders goal groups by meeting start instead of putting goal meetings first', () => {
        mockSortGoalTasksGorups.mockReturnValue({ [GENERAL_TASKS]: 1, 'goal-1': 0 })

        const tree = renderSection([
            ['goal-1', [timed('goal-noon', '2026-08-21T12:00:00+02:00')]],
            [GENERAL_TASKS, [timed('general-nine', '2026-08-21T09:00:00+02:00')]],
        ])

        const renderedGroups = tree.root.findAll(node => node.type === 'TasksList' || node.type === 'ParentGoalSection')
        expect(renderedGroups.map(group => group.props.taskList[0].id)).toEqual(['general-nine', 'goal-noon'])
    })

    it('keeps an earlier goal meeting ahead of later general meetings', () => {
        const tree = renderSection([
            [GENERAL_TASKS, [timed('general-noon', '2026-08-21T12:00:00+02:00')]],
            ['goal-1', [timed('goal-nine', '2026-08-21T09:00:00+02:00')]],
        ])

        const renderedGroups = tree.root.findAll(node => node.type === 'TasksList' || node.type === 'ParentGoalSection')
        expect(renderedGroups.map(group => group.props.taskList[0].id)).toEqual(['goal-nine', 'general-noon'])
    })

    // Being outside MAIN_TASK_INDEX is what keeps priority sorting and dragging off these rows.
    it('renders its lists under the calendar bucket index', () => {
        const tree = renderSection([
            [GENERAL_TASKS, [timed('a', '2026-08-21T09:00:00+02:00')]],
            ['goal-1', [timed('b', '2026-08-21T10:00:00+02:00')]],
        ])

        expect(tree.root.findByType('TasksList').props.taskListIndex).toBe(10)
        expect(tree.root.findByType('ParentGoalSection').props.taskListIndex).toBe(10)
    })

    it('groups meetings under their goal', () => {
        const tree = renderSection([['goal-1', [timed('b', '2026-08-21T10:00:00+02:00')]]])

        const goalSection = tree.root.findByType('ParentGoalSection')
        expect(goalSection.props.goalId).toBe('goal-1')
        expect(goalSection.props.taskList.map(task => task.id)).toEqual(['b'])
    })

    it('offers a re-sync for the project the calendar is connected to', () => {
        const tree = renderSection([[GENERAL_TASKS, [timed('a', '2026-08-21T09:00:00+02:00')]]])

        expect(tree.root.findByType('ReloadCalendar').props.projectId).toEqual(['project-1'])
    })

    it('offers no re-sync when no calendar is connected', () => {
        mockState.loggedUser.apisConnected = {}
        const tree = renderSection([[GENERAL_TASKS, [timed('a', '2026-08-21T09:00:00+02:00')]]])

        expect(tree.root.findAllByType('ReloadCalendar')).toHaveLength(0)
    })

    it('renders nothing until the goal ordering is known', () => {
        mockSortGoalTasksGorups.mockReturnValue(undefined)
        const tree = renderSection([[GENERAL_TASKS, [timed('a', '2026-08-21T09:00:00+02:00')]]])

        expect(tree.toJSON()).toBeNull()
    })
})
