/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { StyleSheet } from 'react-native'

import ManageTaskModal from './ManageTaskModal'
import useModalSizing from '../../../../hooks/useModalSizing'

const mockUseTaskEditorLock = jest.fn()

jest.mock('../../../../hooks/useModalSizing', () => jest.fn())
jest.mock('../../../../hooks/useTaskEditorLock', () => active => mockUseTaskEditorLock(active))
jest.mock('../../../../utils/useWindowSize', () => ({
    withWindowSizeHook: Component => props => {
        const ReactForMock = jest.requireActual('react')
        return ReactForMock.createElement(Component, { ...props, windowSize: [1024, 768] })
    },
}))
jest.mock('../../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ openModals: {}, loggedUser: { uid: 'user-1' } }),
        subscribe: () => jest.fn(),
    },
}))
jest.mock('../../../ModalsManager/modalsManager', () => ({
    MANAGE_TASK_MODAL_ID: 'manage-task',
    removeModal: jest.fn(),
}))
jest.mock('../../../../utils/HelperFunctions', () => ({
    applyPopoverWidth: () => ({ width: 432, minWidth: 432, maxWidth: 432 }),
    dismissPopupInBackground: jest.fn(),
}))
jest.mock('../../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { watchSubtasks: jest.fn(), unwatch: jest.fn() },
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
}))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({ TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant' }))
jest.mock('../../../../URLSystem/URLTrigger', () => ({ __esModule: true, default: { processUrl: jest.fn() } }))
jest.mock('../../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../../../utils/LinkingHelper', () => ({ getDvMainTabLink: jest.fn() }))
jest.mock('./Header', () => 'Header')
jest.mock('./TaskArea', () => 'TaskArea')
jest.mock('./AddSubtask', () => 'AddSubtask')
jest.mock('../../../UIControls/CustomScrollView', () => 'CustomScrollView')

const renderModal = props =>
    renderer.create(<ManageTaskModal projectId="project-1" closeModal={jest.fn()} {...props} />)

describe('ManageTaskModal add-task width (AT-2582)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useModalSizing.mockReturnValue({ width: 640, isSheet: false })
    })

    it('uses the large popup width when the note toolbar creates a task', () => {
        const tree = renderModal({ editing: false })
        const style = StyleSheet.flatten(tree.root.findByType('CustomScrollView').props.style)

        expect(style).toMatchObject({ width: 640, minWidth: 640, maxWidth: 640 })
        expect(mockUseTaskEditorLock).toHaveBeenCalledWith(false)
        tree.unmount()
    })

    it('keeps the existing width when editing a task', () => {
        const tree = renderModal({
            editing: true,
            task: { id: 'task-1', userId: 'user-1', assigneeType: 'user' },
        })
        const style = StyleSheet.flatten(tree.root.findByType('CustomScrollView').props.style)

        expect(style).toMatchObject({ width: 432, minWidth: 432, maxWidth: 432 })
        expect(mockUseTaskEditorLock).toHaveBeenCalledWith(true)
        tree.unmount()
    })
})
