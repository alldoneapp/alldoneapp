import React from 'react'
import renderer, { act } from 'react-test-renderer'

import MoreButtonWrapper from '../../components/UIComponents/FloatModals/MorePopupsOfEditModals/Common/MoreButtonWrapper'
import { MORE_BUTTON_EDITS_MODAL_ID, removeModal, storeModal } from '../../components/ModalsManager/modalsManager'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector({ openModals: {} }),
}))
jest.mock('react-tiny-popover', () => 'Popover')
jest.mock('../../components/UIComponents/FloatModals/MorePopupsOfEditModals/Common/MoreButton', () => 'MoreButton')
jest.mock(
    '../../components/UIComponents/FloatModals/MorePopupsOfEditModals/Common/MoreButtonModal',
    () => 'MoreButtonModal'
)
jest.mock('../../utils/HelperFunctions', () => ({
    popoverToCenter: jest.fn(),
}))
jest.mock('../../components/ModalsManager/modalsManager', () => ({
    MORE_BUTTON_EDITS_MODAL_ID: 'task-more-modal',
    MENTION_MODAL_ID: 'mention-modal',
    TASK_PARENT_GOAL_MODAL_ID: 'parent-goal-modal',
    removeModal: jest.fn(),
    storeModal: jest.fn(),
}))

describe('MoreButtonWrapper popup lock', () => {
    test('releases its counter and modal registry entries when the task row unmounts', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <MoreButtonWrapper formType="edit" projectId="project-1" object={{ id: 'task-1' }}>
                    {[]}
                </MoreButtonWrapper>
            )
        })

        act(() => {
            tree.root.findByType('MoreButton').props.onPress()
        })
        expect(storeModal).toHaveBeenCalledWith(MORE_BUTTON_EDITS_MODAL_ID)
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Show float popup' })

        act(() => {
            tree.unmount()
        })
        expect(removeModal).toHaveBeenCalledWith(MORE_BUTTON_EDITS_MODAL_ID)
        expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'Hide float popup' })
    })
})
