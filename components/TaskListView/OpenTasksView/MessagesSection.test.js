import React from 'react'
import renderer, { act } from 'react-test-renderer'

import MessagesSection from './MessagesSection'

let mockState
const mockSortGoalTasksGorups = jest.fn()
let mockSectionExpanded = false
const mockExpandSection = jest.fn()
const mockContractSection = jest.fn()
const mockUseCollapsibleTaskSection = jest.fn(() => ({
    expanded: mockSectionExpanded,
    expand: mockExpandSection,
    contract: mockContractSection,
}))

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('./TasksList', () => 'TasksList')
jest.mock('./ParentGoalSection', () => 'ParentGoalSection')
jest.mock('./SwipeableGeneralTasksHeader', () => 'SwipeableGeneralTasksHeader')
jest.mock('../../UIControls/ShowMoreButton', () => 'ShowMoreButton')
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('./useCollapsibleTaskSection', () => args => mockUseCollapsibleTaskSection(args))
// The real module pulls in firestore.js, which needs the build-injected .env.
jest.mock('../../../utils/backends/openTasks', () => ({
    DATE_TASK_INDEX: 0,
    MESSAGE_TASK_INDEX: 11,
    NOT_PARENT_GOAL_INDEX: '0',
    sortGoalTasksGorups: (...args) => mockSortGoalTasksGorups(...args),
}))

const GENERAL_TASKS = '0'
const MESSAGE_TASK_INDEX = 11

const message = id => ({ id })

// What the user sees: the tasks each list actually renders, honouring `amountToRender`.
const visibleTaskIds = tree =>
    tree.root
        .findAll(node => node.type === 'TasksList' || node.type === 'ParentGoalSection')
        .flatMap(node => {
            const { taskList, amountToRender } = node.props
            const amount = amountToRender === undefined ? taskList.length : amountToRender
            return taskList.slice(0, amount).map(task => task.id)
        })

// AT-3027 - Messages get their own expand / collapse chevron, collapsed to the first three.
describe('MessagesSection collapsing (AT-3027)', () => {
    const renderSection = (messageGroups, { isActiveOrganizeMode = false, activeEditMode = false } = {}) => {
        const day = []
        day[0] = 'TODAY'
        day[MESSAGE_TASK_INDEX] = messageGroups
        mockState.filteredOpenTasksStore = { instance: [day] }
        mockState.activeEditMode = activeEditMode
        let tree
        act(() => {
            tree = renderer.create(
                <MessagesSection
                    projectId="project-1"
                    projectIndex={3}
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
            subtaskByTaskStore: {},
            openMilestonesByProjectInTasks: {},
            doneMilestonesByProjectInTasks: {},
            goalsByProjectInTasks: {},
            currentUser: { uid: 'user-1' },
        }
        mockSectionExpanded = false
        mockUseCollapsibleTaskSection.mockClear()
        mockSortGoalTasksGorups.mockReturnValue({ [GENERAL_TASKS]: 0, 'goal-1': 1, 'goal-2': 2 })
    })

    it.each([1, 2, 3])('shows every message and no chevron with %i messages', amount => {
        const messages = Array.from({ length: amount }, (_, index) => message(`m${index}`))
        const tree = renderSection([[GENERAL_TASKS, messages]])

        expect(tree.root.findAllByType('ShowMoreButton')).toHaveLength(0)
        expect(visibleTaskIds(tree)).toEqual(messages.map(task => task.id))
    })

    it('shows the first three messages in goal order and hides later groups', () => {
        const tree = renderSection([
            ['goal-2', [message('g2-a')]],
            [GENERAL_TASKS, [message('a'), message('b')]],
            ['goal-1', [message('g1-a'), message('g1-b')]],
        ])

        expect(visibleTaskIds(tree)).toEqual(['a', 'b', 'g1-a'])
        expect(tree.root.findAllByType('ParentGoalSection').map(node => node.props.goalId)).toEqual(['goal-1'])
        // The last visible group sits flush on the chevron.
        expect(tree.root.findByType('ParentGoalSection').props.containerStyle).toBeNull()
        // goalIndex still addresses the store bucket, not the render position.
        expect(tree.root.findByType('ParentGoalSection').props.goalIndex).toBe(2)
        const button = tree.root.findByType('ShowMoreButton')
        expect(button.props.expanded).toBe(false)
        expect(button.props.expand).toBe(mockExpandSection)
    })

    it('shows every message once expanded and offers the collapse chevron', () => {
        mockSectionExpanded = true
        const tree = renderSection([[GENERAL_TASKS, ['a', 'b', 'c', 'd', 'e'].map(message)]])

        expect(visibleTaskIds(tree)).toEqual(['a', 'b', 'c', 'd', 'e'])
        const button = tree.root.findByType('ShowMoreButton')
        expect(button.props.expanded).toBe(true)
        expect(button.props.contract).toBe(mockContractSection)
    })

    it('shows everything and no chevron in organize mode', () => {
        const tree = renderSection([[GENERAL_TASKS, ['a', 'b', 'c', 'd'].map(message)]], {
            isActiveOrganizeMode: true,
        })

        expect(tree.root.findAllByType('ShowMoreButton')).toHaveLength(0)
        expect(visibleTaskIds(tree)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('keeps a mounted group visible while the user edits, even if a new message takes its slot', () => {
        let tree = renderSection([
            [GENERAL_TASKS, ['a', 'b'].map(message)],
            ['goal-1', [message('g1-a'), message('g1-b')]],
        ])
        expect(visibleTaskIds(tree)).toEqual(['a', 'b', 'g1-a'])

        // A new message lands in General while an editor is open: the goal card must stay mounted.
        mockState.activeEditMode = true
        mockState.filteredOpenTasksStore.instance[0][MESSAGE_TASK_INDEX] = [
            [GENERAL_TASKS, ['new', 'a', 'b'].map(message)],
            ['goal-1', [message('g1-a'), message('g1-b')]],
        ]
        act(() => {
            tree.update(
                <MessagesSection
                    projectId="project-1"
                    projectIndex={3}
                    dateIndex={0}
                    instanceKey="instance"
                    isActiveOrganizeMode={false}
                />
            )
        })

        expect(tree.root.findAllByType('ParentGoalSection').map(node => node.props.goalId)).toEqual(['goal-1'])
    })

    it('keys its state by project, day and the messages section', () => {
        renderSection([[GENERAL_TASKS, [message('a')]]])

        expect(mockUseCollapsibleTaskSection).toHaveBeenCalledWith({
            projectId: 'project-1',
            projectIndex: 3,
            dateKey: 'TODAY',
            sectionKey: 'messages',
        })
    })
})
