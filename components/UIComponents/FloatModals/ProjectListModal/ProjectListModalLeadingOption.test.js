import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ProjectListModal from './ProjectListModal'
import { ALL_PROJECTS_OPTION, AUTOMATIC_PROJECT_OPTION } from '../SelectProjectModal/projectPickerConstants'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }))
jest.mock('../SelectProjectModal/ProjectModalItem', () => 'ProjectModalItem')
jest.mock('../SelectProjectModal/AllProjectItem', () => 'AllProjectItem')
jest.mock('../SelectProjectModal/AutomaticProjectItem', () => 'AutomaticProjectItem')
jest.mock('../SelectProjectModal/HeaderInSearch', () => 'HeaderInSearch')
jest.mock('../../../UIControls/CustomScrollView', () => 'CustomScrollView')
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('../ModalHeader', () => 'ModalHeader')
jest.mock('../GoalMilestoneModal/Line', () => 'Line')
jest.mock('../EmptyResults', () => 'EmptyResults')
jest.mock('../../../../redux/actions', () => ({
    blockBackgroundTabShortcut: () => ({ type: 'block' }),
    unblockBackgroundTabShortcut: () => ({ type: 'unblock' }),
}))
jest.mock('../../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}) }))
jest.mock('../../../../utils/useWindowSize', () => () => [1024, 768])
jest.mock('../../../../utils/modalSafeArea', () => ({ getSafeAreaModalMaxHeight: () => 500 }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))

const projects = [
    { id: 'project-a', name: 'Personal' },
    { id: 'project-b', name: 'Work' },
]

const renderModal = props => {
    const onSelectProject = jest.fn()
    const closeModal = jest.fn()
    let tree
    act(() => {
        tree = renderer.create(
            <ProjectListModal
                projects={projects}
                onSelectProject={onSelectProject}
                closeModal={closeModal}
                {...props}
            />
        )
    })
    return { tree, onSelectProject, closeModal }
}

/**
 * AT-2306: the add-task picker's "Automatic" row reuses the single leading-row
 * slot (index -1) that "All projects" already occupied. These two cases pin that
 * the slot commits the right sentinel for each caller — picking the wrong one
 * would silently create the task in a project the user never chose.
 */
describe('ProjectListModal leading option', () => {
    it('offers Automatic and commits its sentinel for the add-task picker', async () => {
        const { tree, onSelectProject, closeModal } = renderModal({ leadingAutomaticOption: true })

        const automaticRow = tree.root.findByType('AutomaticProjectItem')
        expect(tree.root.findAllByType('AllProjectItem')).toHaveLength(0)
        // The row starts highlighted, which is what makes Automatic the default
        // the user can commit with Return alone.
        expect(automaticRow.props.active).toBe(true)

        await act(async () => {
            await automaticRow.props.onProjectSelect()
        })

        expect(onSelectProject).toHaveBeenCalledWith({ id: AUTOMATIC_PROJECT_OPTION }, -1)
        expect(closeModal).toHaveBeenCalled()
    })

    it('still commits the All projects sentinel for the search-scope picker', async () => {
        const { tree, onSelectProject } = renderModal({ leadingAllOption: true })

        const allRow = tree.root.findByType('AllProjectItem')
        expect(tree.root.findAllByType('AutomaticProjectItem')).toHaveLength(0)

        await act(async () => {
            await allRow.props.onProjectSelect()
        })

        expect(onSelectProject).toHaveBeenCalledWith({ id: ALL_PROJECTS_OPTION }, -1)
    })

    it('shows no leading row when the caller asks for neither', () => {
        const { tree } = renderModal({})

        expect(tree.root.findAllByType('AutomaticProjectItem')).toHaveLength(0)
        expect(tree.root.findAllByType('AllProjectItem')).toHaveLength(0)
    })
})
