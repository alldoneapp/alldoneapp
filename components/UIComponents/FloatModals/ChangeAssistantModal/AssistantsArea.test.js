import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'

import AssistantsArea from './AssistantsArea'

const mockDefaultProjectAssistant = {
    uid: 'default-assistant',
    displayName: 'Default assistant',
    photoURL50: 'default-photo',
}

jest.mock('./AssistantItem', () => 'AssistantItem')
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: jest.fn(() => ({ globalAssistantIds: [] })),
}))
jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    getDefaultAssistantInProjectById: jest.fn(() => mockDefaultProjectAssistant),
}))
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: text => text,
}))

const createStore = projectAssistants => ({
    getState: () => ({
        globalAssistants: [],
        projectAssistants: { project: projectAssistants },
        loggedUser: { defaultProjectId: 'default-project' },
    }),
    subscribe: () => () => {},
    dispatch: jest.fn(),
})

const renderArea = projectAssistants =>
    renderer.create(
        <Provider store={createStore(projectAssistants)}>
            <AssistantsArea
                closeModal={jest.fn()}
                projectId="project"
                updateAssistant={jest.fn()}
                currentAssistantId=""
                defaultProjectAssistantAtEnd={true}
            />
        </Provider>
    )

describe('AssistantsArea', () => {
    it('shows the default-project assistant after the project assistants and a separator', () => {
        const tree = renderArea([{ uid: 'project-assistant', displayName: 'Project assistant' }])
        const assistantItems = tree.root.findAll(node => node.type === 'AssistantItem')

        expect(assistantItems.map(item => item.props.assistant.uid)).toEqual(['project-assistant', 'default-assistant'])
        expect(tree.root.findAllByProps({ testID: 'default-project-assistant-separator' }).length).toBeGreaterThan(0)
    })

    it('does not duplicate the default-project assistant', () => {
        const tree = renderArea([mockDefaultProjectAssistant])
        const assistantItems = tree.root.findAll(node => node.type === 'AssistantItem')

        expect(assistantItems.map(item => item.props.assistant.uid)).toEqual(['default-assistant'])
        expect(tree.root.findAllByProps({ testID: 'default-project-assistant-separator' })).toHaveLength(0)
    })
})
