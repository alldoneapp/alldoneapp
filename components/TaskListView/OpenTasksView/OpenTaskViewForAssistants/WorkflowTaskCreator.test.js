import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import WorkflowTaskCreator from './WorkflowTaskCreator'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'

let mockState
const mockInputClear = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../TaskItem/TaskInput', () => {
    const React = require('react')

    return props => {
        props.inputTask.current = {
            clear: mockInputClear,
            isFocused: () => true,
        }
        return React.createElement('TaskInput', props)
    }
})
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
    act(() => {
        tree.root.findByType('TaskInput').props.onChangeInputText(title)
    })
}

describe('WorkflowTaskCreator', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { smallScreenNavigation: false }
    })

    it('reuses the normal multi-line task input inside the normal task editor pattern', () => {
        const tree = renderCreator()
        const input = tree.root.findByType('TaskInput')
        const touchableElements = tree.root.findAllByType(TouchableOpacity)
        const configurationLink = touchableElements.find(
            element => element.props.accessibilityLabel === 'Configure workflow'
        )
        const executionModeButton = touchableElements.find(
            element => element.props.accessibilityLabel === 'Use workflow'
        )
        const addIcon = tree.root.findAllByType('Icon').find(icon => icon.props.name === 'plus-square')

        expect(input.props).toMatchObject({
            adding: true,
            isSubtask: false,
            projectId: 'project-1',
            accessGranted: true,
        })
        expect(addIcon.props).toMatchObject({ name: 'plus-square', size: 24 })
        expect(configurationLink.findByType(Text).props.children).toBe('Configure workflow')
        expect(executionModeButton.findByType(Text).props.children).toBe('Use workflow')
        expect(tree.root.findByProps({ accessibilityLabel: 'Submit' }).props.disabled).toBe(true)
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

    it('can render the task editor without the duplicate configuration link', () => {
        const tree = renderCreator({ showConfigurationLink: false })

        expect(tree.root.findAllByProps({ accessibilityLabel: 'Configure workflow' })).toHaveLength(0)
        expect(tree.root.findByType('TaskInput')).toBeDefined()
    })

    it('shows only the execution-mode icon on mobile', () => {
        mockState.smallScreenNavigation = true
        const tree = renderCreator({ showConfigurationLink: false })
        const executionModeButton = tree.root
            .findAllByType(TouchableOpacity)
            .find(element => element.props.accessibilityLabel === 'Use workflow')

        expect(executionModeButton.findByType('Icon').props.name).toBe('git-branch')
        expect(executionModeButton.findAllByType(Text)).toHaveLength(0)
    })
})
