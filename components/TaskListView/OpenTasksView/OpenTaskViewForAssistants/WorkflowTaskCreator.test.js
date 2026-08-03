import React from 'react'
import { Text, TextInput, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import WorkflowTaskCreator from './WorkflowTaskCreator'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'

let mockState

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('../../../Icon', () => 'Icon')
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

describe('WorkflowTaskCreator', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { loggedUser: { uid: 'user-1' }, smallScreenNavigation: false }
    })

    it('uses the same flat plus-square entry pattern as the normal add-task line', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <WorkflowTaskCreator projectId="project-1" assistant={{ uid: 'assistant-1' }} disabled={false} />
            )
        })

        const input = tree.root.findByType(TextInput)
        const touchableElements = tree.root.findAllByType(TouchableOpacity)
        const addButton = touchableElements.find(element => element.props.accessibilityLabel === 'Add task')
        const configurationLink = touchableElements.find(
            element => element.props.accessibilityLabel === 'Configure workflow'
        )
        const icons = tree.root.findAllByType('Icon')
        const addIcon = icons.find(icon => icon.props.name === 'plus-square')
        const executionModeButton = touchableElements.find(
            element => element.props.accessibilityLabel === 'Use workflow'
        )

        expect(input.props.placeholder).toBe('Type to add new task')
        expect(addIcon.props).toMatchObject({
            name: 'plus-square',
            size: 24,
        })
        expect(addButton.props.accessibilityLabel).toBe('Add task')
        expect(configurationLink.findByType(Text).props.children).toBe('Configure workflow')
        expect(executionModeButton).toBeDefined()
        expect(executionModeButton.findByType(Text).props.children).toBe('Use workflow')
        expect(tree.root.findAllByType('Button')).toHaveLength(0)
    })

    it('clears the input immediately while task creation continues in the background', async () => {
        let resolveCreation
        generateTaskFromPreConfig.mockReturnValue(
            new Promise(resolve => {
                resolveCreation = resolve
            })
        )

        let tree
        act(() => {
            tree = renderer.create(
                <WorkflowTaskCreator projectId="project-1" assistant={{ uid: 'assistant-1' }} disabled={false} />
            )
        })

        act(() => {
            tree.root.findByType(TextInput).props.onChangeText('Create this task')
        })

        let creationPromise
        act(() => {
            creationPromise = tree.root.findByType(TextInput).props.onSubmitEditing()
        })

        expect(tree.root.findByType(TextInput).props.value).toBe('')
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
    })

    it('can render only the add-task row when configuration is shown in the Tasks header', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <WorkflowTaskCreator
                    projectId="project-1"
                    assistant={{ uid: 'assistant-1' }}
                    disabled={false}
                    showConfigurationLink={false}
                />
            )
        })

        expect(tree.root.findAllByProps({ accessibilityLabel: 'Configure workflow' })).toHaveLength(0)
        expect(tree.root.findByType(TextInput).props.placeholder).toBe('Type to add new task')
    })

    it('shows only the execution-mode icon in the mobile add-task row', () => {
        mockState.smallScreenNavigation = true

        let tree
        act(() => {
            tree = renderer.create(
                <WorkflowTaskCreator
                    projectId="project-1"
                    assistant={{ uid: 'assistant-1' }}
                    disabled={false}
                    showConfigurationLink={false}
                />
            )
        })

        const executionModeButton = tree.root
            .findAllByType(TouchableOpacity)
            .find(element => element.props.accessibilityLabel === 'Use workflow')

        expect(executionModeButton.findByType('Icon').props.name).toBe('git-branch')
        expect(executionModeButton.findAllByType(Text)).toHaveLength(0)
    })
})
