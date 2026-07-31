import React from 'react'
import { Text, TextInput, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import WorkflowTaskCreator from './WorkflowTaskCreator'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' } }),
}))
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../utils/backends/Tasks/TaskServiceFrontendHelper', () => ({
    createTaskWithService: jest.fn(),
}))
jest.mock('../../../../utils/assistantWorkflow', () => ({
    assistantWorkflowFirstStepHasPrompt: jest.fn(() => true),
    buildAssistantWorkflowTask: jest.fn(),
}))
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
        const workflowTitle = tree.root.findAllByType(Text).find(element => element.props.children === 'Workflow tasks')
        const icon = tree.root.findByType('Icon')

        expect(input.props.placeholder).toBe('Type to add new task')
        expect(icon.props).toMatchObject({
            name: 'plus-square',
            size: 24,
        })
        expect(addButton.props.accessibilityLabel).toBe('Add task')
        expect(configurationLink.findByType(Text).props.children).toBe('Configure workflow')
        expect(configurationLink.parent).toBe(workflowTitle.parent)
        expect(tree.root.findAllByType('Button')).toHaveLength(0)
    })
})
