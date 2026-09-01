import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ProjectListModal from './ProjectListModal'

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

const renderModal = onSelectProject => {
    const closeModal = jest.fn()
    let tree
    act(() => {
        tree = renderer.create(
            <ProjectListModal projects={projects} onSelectProject={onSelectProject} closeModal={closeModal} />
        )
    })
    return { tree, closeModal }
}

const pressRow = (tree, index) =>
    act(() => {
        tree.root.findAllByType('ProjectModalItem')[index].props.onProjectSelect()
    })

const pressKey = key =>
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })

/**
 * The commit is awaited to completion before the picker closes, and a
 * cross-project move is several seconds of work. The picker therefore stays on
 * screen and interactive throughout — which is exactly when a person clicks
 * again. Two runs of the same move then race over one document, and whichever
 * deletes the source first leaves the other writing to a document that no longer
 * exists. Under the hardened rules that is reported as `permission-denied`, not
 * `not-found`, so the duplicate run announces the move as broken while the move
 * it duplicated succeeded.
 */
describe('ProjectListModal commit re-entrancy', () => {
    it('ignores further presses while a commit is still running', async () => {
        let releaseCommit
        const onSelectProject = jest.fn(() => new Promise(resolve => (releaseCommit = resolve)))
        const { tree, closeModal } = renderModal(onSelectProject)

        pressRow(tree, 0)
        expect(onSelectProject).toHaveBeenCalledTimes(1)

        pressRow(tree, 0)
        pressRow(tree, 1)
        expect(onSelectProject).toHaveBeenCalledTimes(1)
        expect(closeModal).not.toHaveBeenCalled()

        await act(async () => {
            releaseCommit()
        })
        expect(closeModal).toHaveBeenCalledTimes(1)
    })

    it('ignores Return while a commit is still running', async () => {
        let releaseCommit
        const onSelectProject = jest.fn(() => new Promise(resolve => (releaseCommit = resolve)))
        renderModal(onSelectProject)

        // The keyboard path is its own way in: the document-level listener stays
        // installed for the whole commit, so holding Return re-fires it.
        pressKey('ArrowDown')
        pressKey('Enter')
        expect(onSelectProject).toHaveBeenCalledTimes(1)

        pressKey('Enter')
        pressKey('Enter')
        expect(onSelectProject).toHaveBeenCalledTimes(1)

        await act(async () => {
            releaseCommit()
        })
    })

    it('accepts a new commit once the previous one has settled', async () => {
        const onSelectProject = jest.fn(() => Promise.resolve())
        const { tree } = renderModal(onSelectProject)

        await act(async () => {
            tree.root.findAllByType('ProjectModalItem')[0].props.onProjectSelect()
        })
        await act(async () => {
            tree.root.findAllByType('ProjectModalItem')[1].props.onProjectSelect()
        })

        expect(onSelectProject).toHaveBeenCalledTimes(2)
    })

    it('releases the guard after a failed commit so the user can retry', async () => {
        const onSelectProject = jest
            .fn()
            .mockRejectedValueOnce(new Error('permission-denied'))
            .mockResolvedValueOnce(undefined)
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        const { tree } = renderModal(onSelectProject)

        await act(async () => {
            tree.root.findAllByType('ProjectModalItem')[0].props.onProjectSelect()
        })
        await act(async () => {
            tree.root.findAllByType('ProjectModalItem')[0].props.onProjectSelect()
        })

        expect(onSelectProject).toHaveBeenCalledTimes(2)
        consoleError.mockRestore()
    })
})
