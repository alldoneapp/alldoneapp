import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ProjectAssistantLine from './ProjectAssistantLine'
import useProjectData from '../../../hooks/useProjectData'

let mockState
const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
}))
jest.mock('./AssistantLine', () => 'AssistantLine')
jest.mock('../../../hooks/useProjectData', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../../utils/InitialLoad/projectDataLoader', () => ({ PROJECT_DATA_ASSISTANTS: 'assistants' }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../redux/actions', () => ({
    setAssistantLineAssistant: (projectId, assistantId) => ({ type: 'select', projectId, assistantId }),
}))

const project = { id: 'project', assistantId: 'project-assistant' }
const render = () => {
    let tree
    act(() => {
        tree = renderer.create(<ProjectAssistantLine project={project} />)
    })
    return tree
}

beforeEach(() => {
    jest.clearAllMocks()
    mockState = {
        loggedUser: { uid: 'user', defaultProjectId: 'default' },
        defaultAssistant: { uid: 'default-assistant', displayName: 'Anna' },
        loggedUserProjectsMap: { default: { id: 'default' } },
        projectAssistants: {
            project: [
                { uid: 'project-assistant', displayName: 'Project assistant' },
                { uid: 'other-assistant', displayName: 'Other assistant' },
            ],
        },
        assistantLineSelection: {},
    }
})

it('uses the Tasks assistant, preview scope and switch behavior', () => {
    const tree = render()
    const { props } = tree.root.findByType('AssistantLine')
    expect(props).toMatchObject({
        projectOverride: project,
        assistantIdOverride: 'project-assistant',
        showLastComment: true,
        useAssistantProjectContext: false,
        useGlobalLatestComment: false,
    })
    expect(useProjectData).toHaveBeenCalledWith('project', 'assistants')
    act(() => props.assistantSwitch.onSelect({ assistantId: 'other-assistant' }))
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'select', projectId: 'project', assistantId: 'other-assistant' })

    // A choice made in Tasks (or any sibling tab) is reused when another section mounts.
    act(() => tree.unmount())
    mockState.assistantLineSelection.project = 'other-assistant'
    const nextSection = render()
    expect(nextSection.root.findByType('AssistantLine').props).toMatchObject({
        assistantIdOverride: 'other-assistant',
        preferAssistantIdOverride: true,
    })
})

it('hides the line for anonymous users without requesting assistant data', () => {
    mockState.loggedUser.isAnonymous = true
    expect(render().toJSON()).toBeNull()
    expect(useProjectData).toHaveBeenCalledWith(undefined, 'assistants')
})

it('hides the line when no assistant can be resolved', () => {
    mockState.defaultAssistant = null
    let tree
    act(() => {
        tree = renderer.create(<ProjectAssistantLine project={{ id: 'unconfigured' }} />)
    })
    expect(tree.toJSON()).toBeNull()
})
