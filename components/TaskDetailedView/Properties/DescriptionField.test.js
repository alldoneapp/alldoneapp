/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import DescriptionField from './DescriptionField'
import Backend from '../../../utils/BackendBridge'
import { hasPendingDescriptionAttachments, updateNewAttachmentsData } from '../../Feeds/Utils/HelperFunctions'
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
jest.mock('../../../utils/BackendBridge', () => ({
    setGoalDescription: jest.fn(),
    setProjectDescription: jest.fn(),
    updateSkillDescription: jest.fn(),
}))
jest.mock('../../Feeds/Utils/HelperFunctions', () => ({
    updateNewAttachmentsData: jest.fn(),
    hasPendingDescriptionAttachments: jest.fn(),
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

describe('detail description autosave', () => {
    const trees = []
    const mount = (props = {}) => {
        let tree
        act(() => {
            tree = renderer.create(
                <DescriptionField
                    projectId="project-1"
                    object={{ id: 'task-1', description: 'Existing description' }}
                    disabled={false}
                    objectType="task"
                    {...props}
                />
            )
        })
        trees.push(tree)
        return tree
    }
    afterEach(async () => {
        await act(async () => {
            trees.splice(0).forEach(tree => tree.unmount())
        })
        jest.useRealTimers()
    })
    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
        setTaskDescription.mockReset().mockResolvedValue(undefined)
        hasPendingDescriptionAttachments.mockReturnValue(false)
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

        trees.push(tree)
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

        trees.push(tree)
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

        trees.push(tree)
        hasPendingDescriptionAttachments.mockReturnValue(true)
        act(() => {
            tree.root.findByType('CustomTextInput3').props.onChangeText('Description with local attachment')
        })
        await act(async () => {
            await Promise.resolve()
        })

        expect(updateNewAttachmentsData).toHaveBeenCalledWith('project-1', 'Description with local attachment', {
            strict: true,
            uploadedTokens: expect.any(Map),
        })
        expect(setTaskDescription).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            'Description with uploaded attachment',
            object,
            'Existing description'
        )
    })
    it('removes Save/OK and debounces text changes without saving on mount', async () => {
        updateNewAttachmentsData.mockImplementation(async (_project, text) => text)
        const tree = mount()
        expect(tree.root.findAllByType('Button')).toHaveLength(0)
        expect(updateNewAttachmentsData).not.toHaveBeenCalled()
        act(() => tree.root.findByType('CustomTextInput3').props.onChangeText('first'))
        await act(async () => jest.advanceTimersByTime(500))
        act(() => tree.root.findByType('CustomTextInput3').props.onChangeText('latest'))
        await act(async () => jest.advanceTimersByTime(999))
        expect(setTaskDescription).not.toHaveBeenCalled()
        await act(async () => jest.advanceTimersByTime(1))
        expect(setTaskDescription).toHaveBeenCalledTimes(1)
        expect(setTaskDescription.mock.calls[0][2]).toBe('latest')
        expect(tree.root.findByType('CustomTextInput3').props.allowPlainEnterBreakLines).toBe(true)
    })

    it('shows a failed save, keeps the draft, and retries', async () => {
        updateNewAttachmentsData.mockImplementation(async (_project, text) => text)
        setTaskDescription.mockRejectedValueOnce(new Error('permission-denied'))
        const tree = mount()
        act(() => tree.root.findByType('CustomTextInput3').props.onChangeText('unsaved'))
        await act(async () => jest.advanceTimersByTime(1000))
        expect(tree.root.findByType('CustomTextInput3').props.initialTextExtended).toBe('unsaved')
        expect(tree.root.findByType('Button').props.title).toBe('Try again')
        await act(async () => tree.root.findByType('Button').props.onPress())
        expect(setTaskDescription).toHaveBeenCalledTimes(2)
        expect(tree.root.findAllByType('Button')).toHaveLength(0)
    })

    it('never writes when read-only', async () => {
        const tree = mount({ disabled: true })
        act(() => tree.root.findByType('CustomTextInput3').props.onChangeText('forbidden'))
        await act(async () => jest.advanceTimersByTime(1000))
        expect(updateNewAttachmentsData).not.toHaveBeenCalled()
        expect(setTaskDescription).not.toHaveBeenCalled()
        expect(tree.root.findAllByType('AddFeedAttachButton')).toHaveLength(0)
    })

    it('keeps Enter available for selecting mentions without inserting a newline', () => {
        const tree = mount()
        act(() => tree.root.findByType('CustomTextInput3').props.setMentionsModalActive(true))
        expect(tree.root.findByType('CustomTextInput3').props.allowPlainEnterBreakLines).toBe(false)
        act(() => tree.root.findByType('CustomTextInput3').props.setMentionsModalActive(false))
        expect(tree.root.findByType('CustomTextInput3').props.allowPlainEnterBreakLines).toBe(true)
    })

    it('flushes pending edits when navigating to another object', async () => {
        updateNewAttachmentsData.mockImplementation(async (_project, text) => text)
        const tree = mount()
        act(() => tree.root.findByType('CustomTextInput3').props.onChangeText('old task draft'))
        await act(async () =>
            tree.update(
                <DescriptionField
                    projectId="project-1"
                    object={{ id: 'task-2', description: 'Second task' }}
                    disabled={false}
                    objectType="task"
                />
            )
        )
        expect(setTaskDescription.mock.calls[0].slice(0, 3)).toEqual(['project-1', 'task-1', 'old task draft'])
        expect(tree.root.findByType('CustomTextInput3').props.initialTextExtended).toBe('Second task')
    })

    it.each([
        ['goal', 'setGoalDescription'],
        ['project', 'setProjectDescription'],
        ['skill', 'updateSkillDescription'],
    ])('autosaves the %s description through its existing backend', async (objectType, method) => {
        updateNewAttachmentsData.mockImplementation(async (_project, text) => text)
        const tree = mount({ objectType })
        act(() => tree.root.findByType('CustomTextInput3').props.onChangeText('changed'))
        await act(async () => jest.advanceTimersByTime(1000))
        expect(Backend[method]).toHaveBeenCalledTimes(1)
        expect(Backend[method].mock.calls.at(-1)).toContain('changed')
        expect(setTaskDescription).not.toHaveBeenCalled()
    })
})
