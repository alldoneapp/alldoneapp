import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: () => false,
}))

jest.mock('../../../../utils/HelperFunctions', () => ({
    applyPopoverWidth: () => ({}),
}))
jest.mock('../../../../utils/modalSafeArea', () => ({
    getSafeAreaModalMaxHeight: height => height,
}))
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

jest.mock('../ModalHeader', () => 'ModalHeader')
jest.mock('../../../GlobalSearchAlgolia/Filter/ProjectFilter', () => 'ProjectFilter')
jest.mock('./SelectedGoalRow', () => 'SelectedGoalRow')
jest.mock('./AssigneeArea', () => 'AssigneeArea')
jest.mock('./TaskEditForm', () => 'TaskEditForm')

import MainModal from './MainModal'

const baseProps = {
    projectId: 'project-goal',
    closeModal: jest.fn(),
    task: { name: 'Prepare launch', userId: 'user-1' },
    showAssigneeModal: false,
    showDueDate: jest.fn(),
    showRecurring: jest.fn(),
    showParentGoal: jest.fn(),
    showPrivacy: jest.fn(),
    showAssignee: jest.fn(),
    showSelectProject: jest.fn(),
    createTask: jest.fn(),
    setTask: jest.fn(),
    showMoreOptions: jest.fn(),
    selectedProject: { id: 'project-goal', name: 'Goal project' },
    widthStyle: {},
}

const renderModal = activeGoal => {
    let tree
    act(() => {
        tree = renderer.create(<MainModal {...baseProps} activeGoal={activeGoal} />)
    })
    return tree
}

describe('MainModal selected goal layout (AT-2580)', () => {
    it('places the selected goal row directly after the project selector', () => {
        const tree = renderModal({ id: 'goal-1', extendedName: 'Prepare launch' })
        const projectRow = tree.root.findByType('ProjectFilter')
        const goalRow = tree.root.findByType('SelectedGoalRow')
        const siblings = projectRow.parent.children

        expect(goalRow.parent).toBe(projectRow.parent)
        expect(siblings.indexOf(goalRow)).toBe(siblings.indexOf(projectRow) + 1)
    })

    it('does not reserve a goal row before a goal is selected', () => {
        const tree = renderModal(null)

        expect(tree.root.findAllByType('SelectedGoalRow')).toHaveLength(0)
    })
})
