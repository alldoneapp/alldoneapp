import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ProjectListModal from './ProjectListModal'
import {
    ALL_ARCHIVED_PROJECTS_OPTION,
    ALL_PROJECTS_OPTION,
    AUTOMATIC_PROJECT_OPTION,
} from '../SelectProjectModal/projectPickerConstants'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }))
jest.mock('../SelectProjectModal/ProjectModalItem', () => 'ProjectModalItem')
jest.mock('../SelectProjectModal/AllProjectItem', () => 'AllProjectItem')
jest.mock('../SelectProjectModal/AutomaticProjectItem', () => 'AutomaticProjectItem')
jest.mock('../SelectProjectModal/AllArchivedProjectItem', () => 'AllArchivedProjectItem')
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

/**
 * AT-2390: the search scope picker needs a DIFFERENT leading row per tab —
 * "All active" on Active, "All archived" on Archived. Before this, the single
 * leading row was hard-wired to the FIRST tab, so the Archived tab could only
 * ever list individual projects.
 */
describe('ProjectListModal per-tab leading option', () => {
    const tabs = [
        {
            key: 'active',
            name: 'Active',
            projects: [{ id: 'project-a', name: 'Personal' }],
            leadingOptionId: ALL_PROJECTS_OPTION,
            leadingOptionLabel: 'All active',
        },
        {
            key: 'archived',
            name: 'Archived',
            projects: [{ id: 'project-z', name: 'Old thing' }],
            leadingOptionId: ALL_ARCHIVED_PROJECTS_OPTION,
            leadingOptionLabel: 'All archived',
        },
    ]

    const switchTab = (tree, index) =>
        act(() => {
            tree.root.findByType('HeaderInSearch').props.changeTab(index)
        })

    it('renders each tab’s own leading row and commits that tab’s sentinel', async () => {
        const { tree, onSelectProject } = renderModal({ tabs })

        // Active tab: the All-projects row, relabelled by the caller.
        const activeRow = tree.root.findByType('AllProjectItem')
        expect(tree.root.findAllByType('AllArchivedProjectItem')).toHaveLength(0)
        expect(activeRow.props.label).toBe('All active')
        await act(async () => activeRow.props.onProjectSelect())
        expect(onSelectProject).toHaveBeenCalledWith({ id: ALL_PROJECTS_OPTION }, -1)

        onSelectProject.mockClear()
        switchTab(tree, 1)

        // Archived tab: its own row, and the Active one is gone rather than
        // lingering as a second way to commit the wrong sentinel.
        const archivedRow = tree.root.findByType('AllArchivedProjectItem')
        expect(tree.root.findAllByType('AllProjectItem')).toHaveLength(0)
        expect(archivedRow.props.label).toBe('All archived')
        await act(async () => archivedRow.props.onProjectSelect())
        expect(onSelectProject).toHaveBeenCalledWith({ id: ALL_ARCHIVED_PROJECTS_OPTION }, -1)
    })

    it('still lists the tab’s individual projects beside the leading row', () => {
        const { tree } = renderModal({ tabs })

        switchTab(tree, 1)

        // The whole point of the ticket: "All archived" is offered ALONGSIDE the
        // archived projects, not instead of them.
        expect(tree.root.findByType('AllArchivedProjectItem')).toBeTruthy()
        const rows = tree.root.findAllByType('ProjectModalItem')
        expect(rows.map(row => row.props.newProject.id)).toEqual(['project-z'])
    })

    it('keyboard cycles through the leading row of whichever tab is active', () => {
        const { tree } = renderModal({ tabs })

        switchTab(tree, 1)
        // -1 is the leading slot, and it is highlighted after a tab switch, so
        // Return commits "All archived" without any arrow key.
        expect(tree.root.findByType('AllArchivedProjectItem').props.active).toBe(true)

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
        })
        expect(tree.root.findByType('AllArchivedProjectItem').props.active).toBe(false)
        expect(tree.root.findByType('ProjectModalItem').props.active).toBe(true)

        // One more wraps back to the leading row: the cycle spans list + 1 slot.
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
        })
        expect(tree.root.findByType('AllArchivedProjectItem').props.active).toBe(true)
    })

    it('leaves a tab that declares no leading row without one', () => {
        // Once ANY tab owns its leading row the per-tab mechanism is in charge,
        // so a tab with none must not silently inherit the caller-level prop —
        // that would put "All projects" on top of the Community list.
        const mixedTabs = [
            { ...tabs[0] },
            { key: 'community', name: 'Community', projects: [{ id: 'guide-1', name: 'Guide' }] },
        ]
        const { tree } = renderModal({ tabs: mixedTabs, leadingAllOption: true })

        switchTab(tree, 1)

        expect(tree.root.findAllByType('AllProjectItem')).toHaveLength(0)
        expect(tree.root.findAllByType('AllArchivedProjectItem')).toHaveLength(0)
    })

    it('keeps the first-tab-only behaviour for tabbed callers that declare nothing', () => {
        const plainTabs = [
            { key: 'active', name: 'Active', projects: [{ id: 'project-a', name: 'Personal' }] },
            { key: 'archived', name: 'Archived', projects: [{ id: 'project-z', name: 'Old thing' }] },
        ]
        const { tree } = renderModal({ tabs: plainTabs, leadingAllOption: true })

        expect(tree.root.findAllByType('AllProjectItem')).toHaveLength(1)
        switchTab(tree, 1)
        expect(tree.root.findAllByType('AllProjectItem')).toHaveLength(0)
    })
})
