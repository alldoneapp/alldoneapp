import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import WorkflowTaskCreator from './WorkflowTaskCreator'
import TaskInput from '../../TaskItem/TaskInput'
import TaskInputArea from '../../TaskItem/TaskInputArea'
import ExecutionModeButton from '../../TaskItem/ExecutionModeButton'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'

let mockState
const mockInputClear = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('../../../UIControls/GhostButton', () => 'GhostButton')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')

    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({
            clear: mockInputClear,
            focus: jest.fn(),
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
    const editor = tree.root.findByType('CustomTextInput3')
    expect(editor.props.disabledEdition).toBe(false)
    act(() => {
        editor.props.onChangeText(title)
    })
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

    it('accepts typing through the real shared multi-line task input', () => {
        const tree = renderCreator()
        const inputArea = tree.root.findByType(TaskInputArea)
        const input = tree.root.findByType(TaskInput)
        const editor = tree.root.findByType('CustomTextInput3')
        const touchableElements = tree.root.findAllByType(TouchableOpacity)
        const configurationLink = touchableElements.find(
            element => element.props.accessibilityLabel === 'Configure workflow'
        )
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
                executionMode: 'workflow',
            },
        })
        expect(editor.props).toMatchObject({
            forceBreaklinesLikeEnterAction: true,
            disabledEdition: false,
        })
        expect(addIcon.props).toMatchObject({ name: 'plus-square', size: 24 })
        expect(configurationLink.findByType(Text).props.children).toBe('Configure workflow')
        expect(tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.disabled).toBe(true)

        enterTask(tree, 'A task that wraps across multiple visual lines')

        expect(tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.disabled).toBe(false)
    })

    it('matches the normal inline add-task layout while unselected', () => {
        const tree = renderCreator({ showConfigurationLink: false })
        const editorStyle = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-workflow-task-editor' }).props.style
        )
        const actionsStyle = StyleSheet.flatten(
            tree.root.findByProps({ testID: 'assistant-workflow-task-actions' }).props.style
        )
        const addIconStyle = StyleSheet.flatten(tree.root.findByType(TaskInputArea).props.leftAccessory.props.style)

        expect(editorStyle).toMatchObject({
            marginHorizontal: -16,
            backgroundColor: 'transparent',
            borderWidth: 0,
            borderRadius: 0,
            shadowColor: 'transparent',
            elevation: 0,
        })
        expect(actionsStyle).toMatchObject({
            marginHorizontal: 8,
            borderBottomLeftRadius: 4,
            borderBottomRightRadius: 4,
        })
        expect(addIconStyle.left).toBe(7)
    })

    it.each([false, true])('replaces the input avatar with the workflow/direct icon (mobile: %s)', isMobile => {
        mockState.smallScreenNavigation = isMobile
        const tree = renderCreator({ showConfigurationLink: false })
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
        expect(tree.root.findByType(TaskInputArea)).toBeDefined()
    })
})
