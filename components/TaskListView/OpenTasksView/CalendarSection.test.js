import React from 'react'
import renderer, { act } from 'react-test-renderer'

import CalendarSection from './CalendarSection'
import { TaskHierarchyGroup } from '../TaskHierarchy'
import { TASK_GROUP_SPACING } from './taskGroupSpacing'

let mockState
const mockSortGoalTasksGorups = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('./TasksList', () => 'TasksList')
jest.mock('./ParentGoalSection', () => 'ParentGoalSection')
jest.mock('./SwipeableGeneralTasksHeader', () => 'SwipeableGeneralTasksHeader')
jest.mock('../../UIComponents/ReloadCalendar', () => 'ReloadCalendar')
jest.mock('../../UIComponents/FloatModals/PrepareMeetings/CalendarSectionMoreButton', () => 'CalendarSectionMoreButton')
jest.mock('../../../assets/svg/GoogleCalendar', () => 'GoogleCalendar')
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
// The real module pulls in firestore.js, which needs the build-injected .env.
jest.mock('../../../utils/backends/firestore', () => ({ checkIfCalendarConnected: jest.fn() }))
jest.mock('../../../utils/backends/openTasks', () => ({
    CALENDAR_TASK_INDEX: 10,
    DATE_TASK_INDEX: 0,
    NOT_PARENT_GOAL_INDEX: '0',
    sortGoalTasksGorups: (...args) => mockSortGoalTasksGorups(...args),
}))

jest.mock('../../UIControls/ShowMoreButton', () => 'ShowMoreButton')
// AT-3027 - the expand/collapse state is the hook's job (useCollapsibleTaskSection.test.js); here
// it is a switch the tests flip.
let mockSectionExpanded = false
const mockExpandSection = jest.fn()
const mockContractSection = jest.fn()
const mockUseCollapsibleTaskSection = jest.fn(() => ({
    expanded: mockSectionExpanded,
    expand: mockExpandSection,
    contract: mockContractSection,
}))
jest.mock('./useCollapsibleTaskSection', () => args => mockUseCollapsibleTaskSection(args))

const GENERAL_TASKS = '0'

// react-native-web renders <Text> as a DOM element, so the rendered type is not 'Text'. Collect the
// literal strings out of the rendered tree instead.
const renderedText = node => {
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string') return [node]
    if (Array.isArray(node)) return node.flatMap(renderedText)
    return renderedText(node.children)
}

// The headings and lists of the section, in the order they render. `ParentGoalSection` and
// `TasksList` are mocked to host elements, so `findAll` walks them in document order.
const SECTION_TYPES = ['SwipeableGeneralTasksHeader', 'TasksList', 'ParentGoalSection']
const renderedSections = tree => tree.root.findAll(node => SECTION_TYPES.includes(node.type)).map(node => node.type)

// Every meeting the section renders, in the order the user reads them.
const renderedTaskIds = tree =>
    tree.root
        .findAll(node => node.type === 'TasksList' || node.type === 'ParentGoalSection')
        .flatMap(node => node.props.taskList.map(task => task.id))

const meeting = (id, start) => ({ id, calendarData: { email: 'karsten@alldone.app', start } })
const timed = (id, isoStart) => meeting(id, { dateTime: isoStart })
const allDay = (id, day) => meeting(id, { date: day })

// AT-2377 - the dedicated Calendar section on the open-tasks board, removed by AT-2252.
describe('CalendarSection', () => {
    const renderSection = (calendarEvents, { isActiveOrganizeMode = false } = {}) => {
        let tree
        act(() => {
            tree = renderer.create(
                <CalendarSection
                    projectId="project-1"
                    projectIndex={2}
                    calendarEvents={calendarEvents}
                    dateIndex={0}
                    instanceKey="instance"
                    isActiveOrganizeMode={isActiveOrganizeMode}
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
        mockSectionExpanded = false
        mockUseCollapsibleTaskSection.mockClear()
        mockSortGoalTasksGorups.mockReturnValue({ [GENERAL_TASKS]: 0, 'goal-1': 1 })
    })

    it('shows a header naming the calendar provider', () => {
        const tree = renderSection([[GENERAL_TASKS, [timed('a', '2026-08-21T09:00:00+02:00')]]])

        expect(renderedText(tree.toJSON())).toContain('Google Calendar')
    })

    it('passes all displayed project calendar tasks across dates to the heading menu', () => {
        const today = timed('today', '2026-10-05T09:00:00+02:00')
        const tomorrow = timed('tomorrow', '2026-10-06T09:00:00+02:00')
        const day = groups => Object.assign([], { 10: groups })
        mockState.filteredOpenTasksStore = {
            instance: [day([[GENERAL_TASKS, [today]]]), day([['goal-1', [tomorrow]]])],
            otherProject: [day([[GENERAL_TASKS, [timed('unrelated', '2026-10-07T09:00:00+02:00')]]])],
        }
        const tree = renderSection([[GENERAL_TASKS, [today]]])
        expect(tree.root.findByType('CalendarSectionMoreButton').props).toMatchObject({
            projectId: 'project-1',
            tasks: [today, tomorrow],
        })
        act(() => tree.unmount())
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

    // AT-2436 - a goal must not pull its meeting out of the clock order, nor drag the meetings
    // around it along with it. This is the reported case: the 11:30 meeting carries a goal and used
    // to render below the 17:15 one, at the bottom of the section.
    describe('chronological order across goals (AT-2436)', () => {
        const reportedDay = [
            [
                GENERAL_TASKS,
                [
                    timed('ten', '2026-08-26T10:00:00+02:00'),
                    timed('fourteen', '2026-08-26T14:00:00+02:00'),
                    timed('seventeen', '2026-08-26T17:15:00+02:00'),
                ],
            ],
            ['goal-1', [timed('eleven-thirty', '2026-08-26T11:30:00+02:00')]],
        ]

        it('renders every meeting of the day in start order, whatever its goal', () => {
            const tree = renderSection(reportedDay)

            expect(renderedTaskIds(tree)).toEqual(['ten', 'eleven-thirty', 'fourteen', 'seventeen'])
        })

        it('cuts the goal heading into the list and resumes General afterwards', () => {
            const tree = renderSection(reportedDay)

            expect(renderedSections(tree)).toEqual([
                'SwipeableGeneralTasksHeader',
                'TasksList',
                'ParentGoalSection',
                'SwipeableGeneralTasksHeader',
                'TasksList',
            ])
        })

        // The user's report: a General group sat flush on the goal card below it, while a goal card
        // kept 16px. Every group gets the main list's gap (MainSection), the last one none.
        it('spaces goal cards and General groups like the main list', () => {
            const tree = renderSection(reportedDay)

            const gaps = tree.root
                .findAll(node => node.type === TaskHierarchyGroup || node.type === 'ParentGoalSection')
                .map(node => (node.type === TaskHierarchyGroup ? node.props.style : node.props.containerStyle))
                .map(style => style.marginBottom)

            expect(TASK_GROUP_SPACING).toBe(32)
            expect(gaps).toEqual([TASK_GROUP_SPACING, TASK_GROUP_SPACING, 0])
        })

        // Same rule as the main list: the header only means something once a goal heading exists to
        // tell it apart from.
        it('shows no General header on a day where nothing has a goal', () => {
            const tree = renderSection([
                [
                    GENERAL_TASKS,
                    [timed('ten', '2026-08-26T10:00:00+02:00'), timed('fourteen', '2026-08-26T14:00:00+02:00')],
                ],
            ])

            expect(renderedSections(tree)).toEqual(['TasksList'])
        })

        it('gives each run of a split goal its own card and its own ref key', () => {
            const tree = renderSection([
                [
                    'goal-1',
                    [timed('goal-ten', '2026-08-26T10:00:00+02:00'), timed('goal-four', '2026-08-26T16:00:00+02:00')],
                ],
                [GENERAL_TASKS, [timed('general-noon', '2026-08-26T12:00:00+02:00')]],
            ])

            expect(renderedTaskIds(tree)).toEqual(['goal-ten', 'general-noon', 'goal-four'])

            const goalSections = tree.root.findAll(node => node.type === 'ParentGoalSection')
            expect(goalSections.map(section => section.props.goalId)).toEqual(['goal-1', 'goal-1'])
            // `ParentGoalSection` builds GoalItem's refKey out of `nestedTaskListIndex`; two cards
            // sharing one would share a dismissible ref and open each other's edit popup.
            expect(goalSections.map(section => section.props.nestedTaskListIndex)).toEqual([undefined, 1])
        })

        // The bucket index addresses the store, not the rendered run, so both runs of a goal keep it.
        it('keeps addressing the store bucket each run came from', () => {
            const tree = renderSection([
                [
                    'goal-1',
                    [timed('goal-ten', '2026-08-26T10:00:00+02:00'), timed('goal-four', '2026-08-26T16:00:00+02:00')],
                ],
                [GENERAL_TASKS, [timed('general-noon', '2026-08-26T12:00:00+02:00')]],
            ])

            const renderedGroups = tree.root.findAll(
                node => node.type === 'TasksList' || node.type === 'ParentGoalSection'
            )
            expect(renderedGroups.map(group => group.props.goalIndex)).toEqual([0, 1, 0])
        })
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

    // AT-2437 - clicking the header 404'd. The helper owns the URL, but only this level proves the
    // header is wired to it AND that it hands over the calendar payload of a real rendered meeting,
    // which is the half that decides whether the right account is opened.
    describe('opening the provider from the header (AT-2437)', () => {
        let openSpy

        beforeEach(() => {
            openSpy = jest.spyOn(window, 'open').mockImplementation(() => null)
        })

        afterEach(() => {
            openSpy.mockRestore()
        })

        const pressHeaderLink = tree => {
            const link = tree.root.find(node => typeof node.props.onPress === 'function')
            act(() => {
                link.props.onPress()
            })
        }

        it('opens the Google calendar of the account the meetings came from', () => {
            const tree = renderSection([[GENERAL_TASKS, [timed('a', '2026-08-21T09:00:00+02:00')]]])

            pressHeaderLink(tree)

            expect(openSpy).toHaveBeenCalledWith(
                'https://calendar.google.com/calendar/r?authuser=karsten%40alldone.app',
                '_blank'
            )
        })

        it('opens Outlook for a Microsoft calendar instead of the first meeting', () => {
            const microsoftMeeting = {
                id: 'a',
                calendarData: {
                    provider: 'microsoft',
                    link: 'https://outlook.office.com/calendar/item/one-meeting',
                    start: { dateTime: '2026-08-21T09:00:00+02:00' },
                },
            }
            const tree = renderSection([[GENERAL_TASKS, [microsoftMeeting]]])

            pressHeaderLink(tree)

            expect(openSpy).toHaveBeenCalledWith('https://outlook.office.com/calendar/', '_blank')
        })
    })

    it('renders nothing until the goal ordering is known', () => {
        mockSortGoalTasksGorups.mockReturnValue(undefined)
        const tree = renderSection([[GENERAL_TASKS, [timed('a', '2026-08-21T09:00:00+02:00')]]])

        expect(tree.toJSON()).toBeNull()
    })
    // AT-3027 - its own expand / collapse chevron, collapsed to the first three meetings.
    describe('collapsing to the first three meetings (AT-3027)', () => {
        // What the user sees: the tasks each list actually renders, honouring `amountToRender`.
        const visibleTaskIds = tree =>
            tree.root
                .findAll(node => node.type === 'TasksList' || node.type === 'ParentGoalSection')
                .flatMap(node => {
                    const { taskList, amountToRender } = node.props
                    const amount = amountToRender === undefined ? taskList.length : amountToRender
                    return taskList.slice(0, amount).map(task => task.id)
                })

        const fiveMeetings = () => [
            [
                GENERAL_TASKS,
                [
                    timed('d', '2026-08-21T13:00:00+02:00'),
                    timed('a', '2026-08-21T09:00:00+02:00'),
                    timed('e', '2026-08-21T15:00:00+02:00'),
                ],
            ],
            ['goal-1', [timed('b', '2026-08-21T10:00:00+02:00'), timed('c', '2026-08-21T11:00:00+02:00')]],
        ]

        it.each([0, 1, 2, 3])('shows every meeting and no chevron with %i meetings', amount => {
            const meetings = Array.from({ length: amount }, (_, index) =>
                timed(`m${index}`, `2026-08-21T0${index + 1}:00:00+02:00`)
            )
            const tree = renderSection(amount === 0 ? [] : [[GENERAL_TASKS, meetings]])

            expect(tree.root.findAllByType('ShowMoreButton')).toHaveLength(0)
            expect(visibleTaskIds(tree)).toEqual(meetings.map(task => task.id))
        })

        it('shows only the first three meetings in clock order, across goal runs', () => {
            const tree = renderSection(fiveMeetings())

            expect(visibleTaskIds(tree)).toEqual(['a', 'b', 'c'])
            // The later General run has no slot left, so its group is not rendered at all.
            expect(renderedSections(tree)).toEqual(['SwipeableGeneralTasksHeader', 'TasksList', 'ParentGoalSection'])
            // The last visible group sits flush on the chevron.
            expect(tree.root.findByType('ParentGoalSection').props.containerStyle).toEqual({ marginBottom: 0 })
            const button = tree.root.findByType('ShowMoreButton')
            expect(button.props.expanded).toBe(false)
            expect(button.props.expand).toBe(mockExpandSection)
        })

        it('cuts inside a run when the third slot falls in the middle of it', () => {
            const tree = renderSection([
                [
                    GENERAL_TASKS,
                    ['a', 'b', 'c', 'd'].map((id, index) => timed(id, `2026-08-21T0${index + 1}:00:00+02:00`)),
                ],
            ])

            expect(visibleTaskIds(tree)).toEqual(['a', 'b', 'c'])
            expect(tree.root.findByType('TasksList').props.amountToRender).toBe(3)
        })

        it('shows every meeting once expanded and offers the collapse chevron', () => {
            mockSectionExpanded = true
            const tree = renderSection(fiveMeetings())

            expect(visibleTaskIds(tree)).toEqual(['a', 'b', 'c', 'd', 'e'])
            const button = tree.root.findByType('ShowMoreButton')
            expect(button.props.expanded).toBe(true)
            expect(button.props.contract).toBe(mockContractSection)
        })

        it('shows everything and no chevron in organize mode, like the main list', () => {
            const tree = renderSection(fiveMeetings(), { isActiveOrganizeMode: true })

            expect(tree.root.findAllByType('ShowMoreButton')).toHaveLength(0)
            expect(visibleTaskIds(tree)).toEqual(['a', 'b', 'c', 'd', 'e'])
        })

        it('keys its state by project, day and the calendar section', () => {
            mockState.filteredOpenTasksStore = { instance: [['TODAY']] }
            renderSection(fiveMeetings())

            expect(mockUseCollapsibleTaskSection).toHaveBeenCalledWith({
                projectId: 'project-1',
                projectIndex: 2,
                dateKey: 'TODAY',
                sectionKey: 'calendar',
            })
        })
    })
})
