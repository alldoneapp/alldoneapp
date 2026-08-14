import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import WorkflowTaskCreator from './WorkflowTaskCreator'
import AddTask from '../../AddTask'
import TaskInput from '../../TaskItem/TaskInput'
import TaskInputArea from '../../TaskItem/TaskInputArea'
import ExecutionModeButton from '../../TaskItem/ExecutionModeButton'
import CheckboxAndIcon from '../../TaskItem/CheckboxAndIcon'
import { taskEditorLayout } from '../../TaskItem/TaskEditorLayout'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'

let mockState
const mockInputClear = jest.fn()
const mockInputFocus = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('../../../UIControls/GhostButton', () => 'GhostButton')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../UIControls/SocialText/SocialText', () => 'SocialText')
jest.mock('../../../UIControls/Shortcut', () => 'Shortcut')
jest.mock(
    '../../../UIComponents/FloatModals/TaskParentGoalModal/WrapperTaskParentGoalModal',
    () => 'WrapperTaskParentGoalModal'
)
jest.mock('../../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { accessGranted: () => true },
}))
jest.mock('../../../UIComponents/DismissibleItem', () => {
    const React = require('react')

    return React.forwardRef(({ defaultComponent, modalComponent, onToggleModal }, ref) => {
        const [visible, setVisible] = React.useState(false)
        React.useImperativeHandle(ref, () => ({
            openModal: () => setVisible(true),
            closeModal: () => setVisible(false),
        }))
        const onDismiss = () => {
            setVisible(false)
            onToggleModal(false)
        }
        return React.createElement(
            'DismissibleItem',
            { visible, onDismiss },
            visible ? modalComponent : defaultComponent
        )
    })
})
jest.mock('../../TaskItem/TaskAssistantButton', () => 'TaskAssistantButton')
jest.mock('../../TaskItem/TaskCheckbox', () => 'TaskCheckbox')
jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')

    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({
            clear: mockInputClear,
            focus: mockInputFocus,
            isFocused: () => true,
        }))
        return React.createElement('CustomTextInput3', props)
    })
})
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    NOT_ALLOW_EDIT_TAGS: 'not-allowed',
    SUBTASK_THEME: 'subtask',
    TASK_THEME: 'task',
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getProjectIndexById: () => 0 },
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../utils/assistantWorkflow', () => ({
    assistantWorkflowFirstStepHasPrompt: jest.fn(() => true),
}))
jest.mock('../../../../utils/assistantHelper', () => ({ generateTaskFromPreConfig: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({ setSelectedNavItem: jest.fn() }))
jest.mock('../../../../utils/TabNavigationConstants', () => ({ DV_TAB_ASSISTANT_WORKFLOW: 'workflow' }))
jest.mock('../../../../URLSystem/Assistants/URLsAssistants', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_ASSISTANT_DETAILS_WORKFLOW: 'assistant-workflow',
}))
jest.mock('../../../../utils/NavigationService', () => ({
    __esModule: true,
    default: { navigate: jest.fn() },
}))

const renderCreator = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(
            <WorkflowTaskCreator projectId="project-1" assistant={{ uid: 'assistant-1' }} disabled={false} {...props} />
        )
    })
    return tree
}

const enterTask = (tree, title) => {
    expandCreator(tree)
    const editor = tree.root.findByType('CustomTextInput3')
    expect(editor.props.disabledEdition).toBe(false)
    act(() => {
        editor.props.onChangeText(title)
    })
}

const expandCreator = tree => {
    const collapsedTask = tree.root.findAllByType(AddTask)[0]
    if (collapsedTask) {
        act(() => {
            collapsedTask.props.toggleModal()
        })
    }
}

describe('WorkflowTaskCreator', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = {
            smallScreenNavigation: false,
            isMiddleScreen: false,
            currentUser: { uid: 'assistant-1' },
            loggedUser: { uid: 'user-1' },
        }
    })

    it('starts as the normal single-line add-task row and expands into the assistant editor', () => {
        const tree = renderCreator()
        const collapsedTask = tree.root.findByType(AddTask)
        const touchableElements = tree.root.findAllByType(TouchableOpacity)
        const configurationLink = touchableElements.find(
            element => element.props.accessibilityLabel === 'Configure workflow'
        )

        expect(collapsedTask.props).toMatchObject({
            projectId: 'project-1',
            newItem: true,
            hideParentGoalButton: true,
            disabled: false,
            setRepeatModeOnOpen: false,
        })
        expect(configurationLink.findByType(Text).props.children).toBe('Configure workflow')
        expect(tree.root.findAllByType(TaskInputArea)).toHaveLength(0)
        expect(tree.root.findAllByType(ExecutionModeButton)).toHaveLength(0)
        expect(tree.root.findAllByProps({ testID: 'assistant-workflow-task-actions' })).toHaveLength(0)
        expect(tree.root.findAllByProps({ accessibilityLabel: 'Submit' })).toHaveLength(0)

        act(() => {
            collapsedTask.findByType(TouchableOpacity).props.onPress()
        })

        const inputArea = tree.root.findByType(TaskInputArea)
        const input = tree.root.findByType(TaskInput)
        const editor = tree.root.findByType('CustomTextInput3')
        const addIcon = tree.root.findAllByType('Icon').find(icon => icon.props.name === 'plus-square')

        expect(inputArea).toBeDefined()
        expect(input.props).toMatchObject({
            adding: true,
            isSubtask: false,
            projectId: 'project-1',
            accessGranted: true,
            tmpTask: {
                genericData: null,
                calendarData: null,
                gmailData: null,
                subtaskIds: [],
                executionMode: 'workflow',
            },
        })
        expect(editor.props).toMatchObject({
            forceBreaklinesLikeEnterAction: true,
            disabledEdition: false,
        })
        expect(addIcon.props).toMatchObject({ name: 'plus-square', size: 24 })
        expect(inputArea.props.autoFocusInput).toBe(true)
        expect(mockInputFocus).toHaveBeenCalled()
        expect(tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.disabled).toBe(true)

        enterTask(tree, 'A task that wraps across multiple visual lines')

        expect(tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.disabled).toBe(false)

        act(() => {
            tree.root.findByType('DismissibleItem').props.onDismiss()
        })

        expect(tree.root.findByType(AddTask)).toBeDefined()
        expect(tree.root.findAllByProps({ accessibilityLabel: 'Submit' })).toHaveLength(0)

        expandCreator(tree)

        expect(tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.disabled).toBe(true)
    })

    it.each([
        ['desktop', false, false],
        ['mobile', true, false],
        ['disabled desktop', false, true],
        ['disabled mobile', true, true],
    ])('renders only the normal collapsed add-task row on %s', (_label, isMobile, disabled) => {
        mockState.smallScreenNavigation = isMobile
        mockState.isMiddleScreen = isMobile
        const tree = renderCreator({ showConfigurationLink: false, disabled })
        const sectionStyle = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-workflow-task-section' }).props.style
        )
        const collapsedTask = tree.root.findByType(AddTask)
        const collapsedStyle = StyleSheet.flatten(collapsedTask.findAllByType(View)[0].props.style)
        const addButton = collapsedTask.findByType(TouchableOpacity)

        expect(sectionStyle).toEqual(taskEditorLayout.addTaskSection)
        expect(collapsedTask.props.disabled).toBe(disabled)
        expect(collapsedStyle).toMatchObject({ marginLeft: -16, marginRight: -16 })
        expect(collapsedStyle.opacity).toBe(disabled ? 0.5 : undefined)
        expect(addButton.props.disabled).toBe(disabled)
        expect(tree.root.findAllByType(TaskInputArea)).toHaveLength(0)
        expect(tree.root.findAllByProps({ testID: 'assistant-workflow-task-actions' })).toHaveLength(0)
        expect(tree.root.findAllByProps({ accessibilityLabel: 'Submit' })).toHaveLength(0)
    })

    it.each([
        ['desktop', false],
        ['mobile', true],
    ])('shows the shared editor geometry and assistant actions after selection on %s', (_label, isMobile) => {
        mockState.smallScreenNavigation = isMobile
        mockState.isMiddleScreen = isMobile
        const tree = renderCreator({ showConfigurationLink: false })

        expandCreator(tree)

        const editorStyle = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-workflow-task-editor' }).props.style
        )
        const actionsStyle = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-workflow-task-actions' }).props.style
        )
        const inputAreaStyle = StyleSheet.flatten(
            tree.root.findByType(TaskInputArea).findAllByType(View)[0].props.style
        )

        expect(editorStyle).toMatchObject(taskEditorLayout.inlineEditor)
        expect(actionsStyle).toMatchObject({
            ...taskEditorLayout.actionBar,
            ...taskEditorLayout.inlineActionBar,
            alignItems: 'center',
            justifyContent: 'flex-end',
        })
        expect(inputAreaStyle).toMatchObject({
            marginHorizontal: 8,
            backgroundColor: '#ffffff',
            borderRadius: 4,
        })
        expect(inputAreaStyle.borderWidth).toBeUndefined()
        expect(tree.root.findByType(CheckboxAndIcon).props).toMatchObject({ adding: true, isSubtask: false })
        expect(tree.root.findByType(ExecutionModeButton)).toBeDefined()
        expect(tree.root.findByProps({ accessibilityLabel: 'Submit' })).toBeDefined()
    })

    it.each([
        ['desktop', false],
        ['mobile', true],
    ])('does not expand the disabled add-task row on %s', (_label, isMobile) => {
        mockState.smallScreenNavigation = isMobile
        mockState.isMiddleScreen = isMobile
        const tree = renderCreator({ showConfigurationLink: false, disabled: true })

        act(() => {
            tree.root.findByType(AddTask).findByType(TouchableOpacity).props.onPress()
        })

        expect(tree.root.findByType(AddTask)).toBeDefined()
        expect(tree.root.findAllByType(TaskInputArea)).toHaveLength(0)
        expect(tree.root.findAllByProps({ accessibilityLabel: 'Submit' })).toHaveLength(0)
    })

    it.each([false, true])('replaces the input avatar with the workflow/direct icon (mobile: %s)', isMobile => {
        mockState.smallScreenNavigation = isMobile
        const tree = renderCreator({ showConfigurationLink: false })
        expandCreator(tree)
        const inputArea = tree.root.findByType(TaskInputArea)
        const modeButton = tree.root.findByType(ExecutionModeButton)
        const renderedButton = tree.root.findByType('GhostButton')

        expect(inputArea.props.rightAccessory.props.children.type).toBe(ExecutionModeButton)
        expect(modeButton.props.iconOnly).toBe(true)
        expect(renderedButton.props).toMatchObject({
            icon: 'git-branch',
            title: null,
            accessibilityLabel: 'Use workflow',
        })
        expect(inputArea.props.newTaskInFocus).toBeUndefined()

        act(() => renderedButton.props.onPress())

        expect(tree.root.findByType(ExecutionModeButton).props.task.executionMode).toBe('direct')
        expect(tree.root.findByType('GhostButton').props).toMatchObject({
            icon: 'fast-forward',
            title: null,
            accessibilityLabel: 'Bypass workflow',
        })
        expect(tree.root.findByType(TaskInputArea).props.newTaskInFocus).toBeUndefined()
    })

    it('shows immediate submission feedback and keeps the existing task payload', async () => {
        let resolveCreation
        generateTaskFromPreConfig.mockReturnValue(
            new Promise(resolve => {
                resolveCreation = resolve
            })
        )
        const tree = renderCreator()
        enterTask(tree, 'Create this task')

        let creationPromise
        act(() => {
            creationPromise = tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.onPress()
        })

        const submittingButton = tree.root.findByProps({ accessibilityLabel: 'Submit' })
        const submittingFeedback = tree.root.findByProps({ accessibilityLiveRegion: 'polite' })
        expect(submittingButton.props).toMatchObject({
            disabled: true,
            processing: true,
            processingTitle: 'Submitting task',
        })
        expect(submittingFeedback.props.children).toBe('Submitting task')
        expect(mockInputClear).not.toHaveBeenCalled()
        expect(generateTaskFromPreConfig).toHaveBeenCalledWith(
            'project-1',
            'Create this task',
            'assistant-1',
            'Create this task',
            null,
            { executionMode: 'workflow' },
            { skipNavigation: true, waitForDirectRun: false }
        )

        await act(async () => {
            resolveCreation()
            await creationPromise
        })

        expect(mockInputClear).toHaveBeenCalledTimes(1)
        expect(tree.root.findByProps({ accessibilityLiveRegion: 'polite' }).props.children).toBe('Task submitted')
    })

    it('retains the entered task and shows an error when submission fails', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        generateTaskFromPreConfig.mockRejectedValue(new Error('network error'))
        const tree = renderCreator()
        enterTask(tree, 'Retry this task')

        await act(async () => {
            await tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.onPress()
        })

        expect(mockInputClear).not.toHaveBeenCalled()
        expect(tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.disabled).toBe(false)
        expect(tree.root.findByProps({ children: 'The workflow task could not be created' })).toBeDefined()
        console.error.mockRestore()
    })

    it('submits the direct execution payload after switching the input icon', async () => {
        generateTaskFromPreConfig.mockResolvedValue()
        const tree = renderCreator()
        expandCreator(tree)

        act(() => {
            tree.root.findByType('GhostButton').props.onPress()
        })
        enterTask(tree, 'Run directly')

        await act(async () => {
            await tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.onPress()
        })

        expect(generateTaskFromPreConfig).toHaveBeenCalledWith(
            'project-1',
            'Run directly',
            'assistant-1',
            'Run directly',
            null,
            { executionMode: 'direct' },
            { skipNavigation: true, waitForDirectRun: false }
        )
    })

    it('can render the task editor without the duplicate configuration link', () => {
        const tree = renderCreator({ showConfigurationLink: false })

        expect(tree.root.findAllByProps({ accessibilityLabel: 'Configure workflow' })).toHaveLength(0)
        expect(tree.root.findByType(AddTask)).toBeDefined()
        expect(tree.root.findAllByType(TaskInputArea)).toHaveLength(0)
    })
})
