import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import FloatingAddTaskButton from './FloatingAddTaskButton'
import SharedHelper from '../../utils/SharedHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { useVoiceCall } from '../UIComponents/AssistantVoiceCallProvider'
import { AUTOMATIC_PROJECT_OPTION } from '../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

const mockDispatch = jest.fn()
const mockClearStoredWebShareTarget = jest.fn()

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))
jest.mock('../../hooks/useModalSizing', () => () => ({ safeAreaInsets: { right: 3, bottom: 5 } }))
jest.mock('../UIComponents/AssistantVoiceCallProvider', () => ({ useVoiceCall: jest.fn() }))
jest.mock('../../utils/SharedHelper', () => ({ accessGranted: jest.fn(() => true) }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: jest.fn(() => false) },
    checkIfSelectedAllProjects: index => index === -1,
    checkIfSelectedProject: index => index > -1,
}))
jest.mock('../Tags/AddTaskTag', () => 'AddTaskTag')
jest.mock('../../redux/actions', () => ({
    clearPendingWebShareTarget: () => ({ type: 'Clear pending web share target' }),
    setTasksArrowButtonIsExpanded: value => ({
        type: 'Tasks arrow button is expanded',
        tasksArrowButtonIsExpanded: value,
    }),
}))
jest.mock('../../utils/webShareTarget', () => ({
    clearStoredWebShareTarget: () => mockClearStoredWebShareTarget(),
}))

const baseState = {
    selectedProjectIndex: -1,
    loggedUserProjects: [{ id: 'project-1' }],
    loggedUser: { uid: 'user-1' },
    currentUser: { uid: 'user-1' },
    taskViewToggleSection: 'Open',
    taskEditorCount: 0,
    blockShortcuts: false,
}

const renderButton = (overrides = {}, callStatus = 'idle') => {
    const state = { ...baseState, ...overrides }
    useSelector.mockImplementation(selector => selector(state))
    useVoiceCall.mockReturnValue({ status: callStatus })
    return renderer.create(<FloatingAddTaskButton />)
}

describe('FloatingAddTaskButton (AT-2575)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        SharedHelper.accessGranted.mockReturnValue(true)
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
    })

    it.each(['Open', 'In progress', 'Workflow', 'Done'])('stays available on the %s board tab', tab => {
        const addTask = renderButton({ taskViewToggleSection: tab }).root.findByType('AddTaskTag')

        expect(addTask.props.projectId).toBe(AUTOMATIC_PROJECT_OPTION)
        expect(addTask.props.showProjectSelector).toBe(true)
    })

    it('opens directly in the selected project context', () => {
        const addTask = renderButton({ selectedProjectIndex: 0 }).root.findByType('AddTaskTag')

        expect(addTask.props.projectId).toBe('project-1')
        expect(addTask.props.showProjectSelector).toBeUndefined()

        act(() => addTask.props.setPressedShowMoreMainSection())
        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'Tasks arrow button is expanded',
            tasksArrowButtonIsExpanded: true,
        })
    })

    it.each(['connecting', 'connected', 'ending'])('is hidden while a voice call is %s', status => {
        expect(renderButton({}, status).root.findAllByType('AddTaskTag')).toHaveLength(0)
    })

    it('does not show on a selected project the user cannot update', () => {
        SharedHelper.accessGranted.mockReturnValue(false)

        expect(renderButton({ selectedProjectIndex: 0 }).root.findAllByType('AddTaskTag')).toHaveLength(0)
    })

    it('does not add tasks from an assistant board', () => {
        expect(
            renderButton({
                selectedProjectIndex: 0,
                currentUser: { uid: 'assistant-1', temperature: 0.4 },
            }).root.findAllByType('AddTaskTag')
        ).toHaveLength(0)
    })

    it('preserves the All Projects shared-link auto-open flow', () => {
        const addTask = renderButton({
            pendingWebShareTarget: { id: 'share-1', taskName: 'https://example.com/article' },
        }).root.findByType('AddTaskTag')

        expect(addTask.props.initialTaskName).toBe('https://example.com/article')
        expect(addTask.props.autoOpenKey).toBe('share-1')

        act(() => addTask.props.onAutoOpen())
        expect(mockClearStoredWebShareTarget).toHaveBeenCalledTimes(1)
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Clear pending web share target' })
    })

    it('is anchored to the safe bottom-right corner of the screen', () => {
        const tree = renderButton()
        const wrapper = tree.root.findByProps({ testID: 'floating-add-task-button' })
        const styles = StyleSheet.flatten(wrapper.props.style)
        const addTask = tree.root.findByType('AddTaskTag')

        expect(styles).toMatchObject({ position: 'absolute', right: 27, bottom: 29 })
        expect(addTask.props.floating).toBe(true)
        expect(addTask.props.plusShortcutEnabled).toBe(true)
    })

    it('draws the shadow on the circular action itself', () => {
        const button = renderButton().root.findByType('AddTaskTag')
        const styles = StyleSheet.flatten(button.props.style)

        expect(styles).toMatchObject({
            width: 56,
            height: 56,
            borderRadius: 28,
            boxShadow: '0px 6px 16px rgba(4,20,47,0.24)',
        })
    })

    it('hides without unmounting while a task editor is active', () => {
        const tree = renderButton({ taskEditorCount: 1 })
        const wrapper = tree.root.findByProps({ testID: 'floating-add-task-button' })

        expect(tree.root.findAllByType('AddTaskTag')).toHaveLength(1)
        expect(StyleSheet.flatten(wrapper.props.style).opacity).toBe(0)
        expect(wrapper.props.pointerEvents).toBe('none')
        expect(wrapper.props.accessibilityElementsHidden).toBe(true)
        expect(tree.root.findByType('AddTaskTag').props.plusShortcutEnabled).toBe(false)
    })

    it('disables the plus shortcut while global shortcuts are blocked', () => {
        const addTask = renderButton({ blockShortcuts: true }).root.findByType('AddTaskTag')

        expect(addTask.props.plusShortcutEnabled).toBe(false)
    })
})
