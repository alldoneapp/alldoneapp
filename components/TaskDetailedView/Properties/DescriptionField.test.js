/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import DescriptionField from './DescriptionField'
import { updateNewAttachmentsData } from '../../Feeds/Utils/HelperFunctions'
import { setTaskDescription } from '../../../utils/backends/Tasks/tasksFirestore'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))
jest.mock('../../Feeds/CommentsTextInput/CustomTextInput3', () => 'CustomTextInput3')
jest.mock('../../Feeds/CommentsTextInput/AttachmentDropZone', () => 'AttachmentDropZone')
jest.mock('../../Feeds/CommentsTextInput/textInputHelper', () => ({
    insertAttachmentInsideEditor: jest.fn(),
    TASK_THEME: 'task-theme',
}))
jest.mock('../../Feeds/AddFeed/AddFeedAttachButton', () => 'AddFeedAttachButton')
jest.mock('../../UIControls/Button', () => 'Button')
jest.mock('../../../utils/BackendBridge', () => ({}))
jest.mock('../../Feeds/Utils/HelperFunctions', () => ({
    updateNewAttachmentsData: jest.fn(),
}))
jest.mock('../../../utils/backends/Assistants/assistantsFirestore', () => ({
    updateAssistantDescription: jest.fn(),
}))
jest.mock('../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskDescription: jest.fn(),
}))
jest.mock('../../ModalsManager/modalsManager', () => ({
    exitsOpenModals: jest.fn(() => false),
}))
jest.mock('../../../i18n/TranslationService', () => ({
    translate: text => text,
}))
jest.mock('../../styles/global', () => ({
    __esModule: true,
    default: {
        body1: {},
        subtitle2: {},
        caption1: {},
    },
    colors: {
        Text01: '#111111',
        Text02: '#222222',
        Text03: '#333333',
        Grey400: '#444444',
    },
}))

describe('task detail description attachments', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        updateNewAttachmentsData.mockResolvedValue('Description with uploaded attachment')
        useSelector.mockImplementation(selector =>
            selector({
                blockShortcuts: false,
                smallScreen: false,
            })
        )
    })

    it('connects the task description editor to the shared attachment drop zone', () => {
        const object = {
            id: 'task-1',
            description: 'Existing description',
        }
        const editor = {
            focus: jest.fn(),
        }
        let tree

        act(() => {
            tree = renderer.create(
                <DescriptionField projectId="project-1" object={object} disabled={false} objectType="task" />
            )
        })

        act(() => {
            tree.root.findByType('CustomTextInput3').props.setEditor(editor)
            tree.root.findByType('CustomTextInput3').props.setInputCursorIndex(9)
        })

        expect(tree.root.findByType('AttachmentDropZone').props).toEqual(
            expect.objectContaining({
                testID: 'task-description-attachment-drop-zone',
                disabled: false,
                editor,
                inputCursorIndex: 9,
                projectId: 'project-1',
            })
        )
    })

    it('disables attachment drops when the description is read-only', () => {
        const tree = renderer.create(
            <DescriptionField
                projectId="project-1"
                object={{ id: 'task-1', description: '' }}
                disabled={true}
                objectType="task"
            />
        )

        expect(tree.root.findByType('AttachmentDropZone').props.disabled).toBe(true)
    })

    it('saves dropped attachment data through the existing description upload path', async () => {
        const object = {
            id: 'task-1',
            description: 'Existing description',
        }
        const tree = renderer.create(
            <DescriptionField projectId="project-1" object={object} disabled={false} objectType="task" />
        )

        act(() => {
            tree.root.findByType('CustomTextInput3').props.onChangeText('Description with local attachment')
        })
        await act(async () => {
            tree.root.findByType('Button').props.onPress()
            await Promise.resolve()
        })

        expect(updateNewAttachmentsData).toHaveBeenCalledWith('project-1', 'Description with local attachment')
        expect(setTaskDescription).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            'Description with uploaded attachment',
            object,
            'Existing description'
        )
    })
})
