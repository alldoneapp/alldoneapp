import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import OpenTasksAssistantPreConfigTasks from './OpenTasksAssistantPreConfigTasks'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('uuid/v4', () => () => 'watcher-1')
jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    watchAssistantTasks: jest.fn((projectId, assistantId, watcherKey, callback) => callback([])),
}))
jest.mock('../../../../utils/backends/firestore', () => ({ unwatch: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({ RECURRENCE_NEVER: 'never' }))
jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({ GLOBAL_PROJECT_ID: 'globalProject' }))
jest.mock('./AssistantInputLine', () => 'AssistantInputLine')
jest.mock('./WhatsAppAssistantLine', () => 'WhatsAppAssistantLine')
jest.mock('./PreConfigTaskGeneratorWrapper', () => 'PreConfigTaskGeneratorWrapper')
jest.mock('./WorkflowTaskCreator', () => 'WorkflowTaskCreator')

describe('assistant profile workflow task creator', () => {
    beforeEach(() => {
        mockState = {
            currentUser: {
                uid: 'assistant-1',
                displayName: 'Project assistant',
            },
            globalAssistants: [],
            loggedUser: {
                isAnonymous: false,
                realProjectIds: ['project-1'],
            },
        }
    })

    it('shows workflow task creation beside the project assistant pre-configured tasks', () => {
        let tree
        act(() => {
            tree = renderer.create(<OpenTasksAssistantPreConfigTasks projectId="project-1" />)
        })

        const creator = tree.root.findByType('WorkflowTaskCreator')
        expect(creator.props).toMatchObject({
            projectId: 'project-1',
            assistant: mockState.currentUser,
            disabled: false,
        })
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual(['Assistant tasks'])
    })

    it('does not show workflow task creation for a global assistant', () => {
        mockState.globalAssistants = [{ uid: 'assistant-1' }]

        let tree
        act(() => {
            tree = renderer.create(<OpenTasksAssistantPreConfigTasks projectId="project-1" />)
        })

        expect(tree.root.findAllByType('WorkflowTaskCreator')).toHaveLength(0)
    })
})
