import React from 'react'
import renderer, { act } from 'react-test-renderer'

import TaskHeaderOverflowModal from './TaskHeaderOverflowModal'
import { openGlobalSearch } from '../../UIControls/DvSearchButton'
import { openViewInNewWindow } from '../../../utils/openInNewWindow'
import { removeModal, storeModal } from '../../ModalsManager/modalsManager'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }))
jest.mock('../../ModalsManager/modalsManager', () => ({
    TASK_HEADER_OVERFLOW_MODAL_ID: 'task-header-overflow',
    storeModal: jest.fn(),
    removeModal: jest.fn(),
}))
jest.mock('../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}) }))
jest.mock('../../UIComponents/FloatModals/ModalHeader', () => 'ModalHeader')
jest.mock('../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/ModalItem', () => 'ModalItem')
jest.mock('../../UIComponents/FloatModals/PrivacyModal/PrivacyModal', () => 'PrivacyModal')
jest.mock('../../UIControls/DvSearchButton', () => ({ openGlobalSearch: jest.fn() }))
jest.mock('../../../utils/openInNewWindow', () => ({ openViewInNewWindow: jest.fn() }))
jest.mock('../../../Themes/colorMode', () => ({ themed: { PopupShadow: 'none' } }))
jest.mock('../../../i18n/TranslationService', () => ({
    translate: (text, interpolations = {}) =>
        Object.entries(interpolations).reduce(
            (translated, [key, value]) => translated.replace(`%{${key}}`, value),
            text === 'Visibility with value' ? 'Visibility: %{value}' : text
        ),
}))

const task = { id: 'task-1', userId: 'owner-1', isPublicFor: [0] }

const renderMenu = props => {
    let tree
    act(() => {
        tree = renderer.create(
            <TaskHeaderOverflowModal
                projectId="project-1"
                task={task}
                showVisibility={true}
                visibilityDisabled={false}
                canSearch={true}
                closeModal={jest.fn()}
                delayCloseModal={jest.fn()}
                {...props}
            />
        )
    })
    return tree
}

const itemTexts = tree => tree.root.findAllByType('ModalItem').map(item => item.props.notTranslatedText)

describe('TaskHeaderOverflowModal (AT-3081)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('lists visibility, search and new window with numbered shortcuts', () => {
        const tree = renderMenu()
        const items = tree.root.findAllByType('ModalItem')

        expect(itemTexts(tree)).toEqual(['Visibility: Project-wide', 'Search', 'Open view in new window'])
        expect(items.map(item => item.props.shortcut)).toEqual(['1', '2', '3'])
        expect(items.map(item => item.props.icon)).toEqual(['unlock', 'search', 'new-window'])
        expect(tree.root.findByType('ModalHeader').props.title).toBe('More options')
    })

    it('leaves visibility out when the header already shows a private chip', () => {
        const tree = renderMenu({ showVisibility: false })

        expect(itemTexts(tree)).toEqual(['Search', 'Open view in new window'])
        expect(tree.root.findAllByType('ModalItem').map(item => item.props.shortcut)).toEqual(['1', '2'])
    })

    it('offers no search to a shared viewer', () => {
        const tree = renderMenu({ canSearch: false, visibilityDisabled: true })

        expect(itemTexts(tree)).toEqual(['Visibility: Project-wide', 'Open view in new window'])
        expect(tree.root.findAllByType('ModalItem')[0].props.disabled).toBe(true)
    })

    it('opens the same visibility picker the header chip opens', () => {
        const closeModal = jest.fn()
        const delayCloseModal = jest.fn()
        const tree = renderMenu({ closeModal, delayCloseModal })

        act(() => tree.root.findAllByType('ModalItem')[0].props.onPress())

        expect(tree.root.findAllByType('ModalItem')).toHaveLength(0)
        expect(tree.root.findByType('PrivacyModal').props).toEqual({
            object: task,
            objectType: 'task',
            projectId: 'project-1',
            closePopover: closeModal,
            delayClosePopover: delayCloseModal,
        })
    })

    it('closes the menu before opening search or a new window', () => {
        const closeModal = jest.fn()
        const tree = renderMenu({ closeModal })
        const [, search, newWindow] = tree.root.findAllByType('ModalItem')

        act(() => search.props.onPress())
        expect(closeModal).toHaveBeenCalledTimes(1)
        expect(openGlobalSearch).toHaveBeenCalledWith(mockDispatch)

        act(() => newWindow.props.onPress())
        expect(closeModal).toHaveBeenCalledTimes(2)
        expect(openViewInNewWindow).toHaveBeenCalledTimes(1)
    })

    it('registers itself as an open modal while mounted', () => {
        const tree = renderMenu()
        expect(storeModal).toHaveBeenCalledWith('task-header-overflow')

        act(() => tree.unmount())
        expect(removeModal).toHaveBeenCalledWith('task-header-overflow')
    })
})
