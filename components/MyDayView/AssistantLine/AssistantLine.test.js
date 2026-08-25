import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantLine from './AssistantLine'

const mockAssistant = { uid: 'assistant-1', displayName: 'Assistant' }
const mockProject = { id: 'project-1', assistantId: 'assistant-1' }
let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('./AssistantOptions/AssistantOptions', () => 'AssistantOptions')
jest.mock('./LastCommentArea', () => 'LastCommentArea')
jest.mock('../../AdminPanel/Assistants/AssistantAvatar', () => 'AssistantAvatar')
jest.mock('../../Icon', () => 'Icon')
// The switch control reaches the popover/modal stack and from there the firestore client; its
// own behaviour is covered by AssistantSwitchControl.test.js.
jest.mock('./AssistantSwitchControl', () => 'AssistantSwitchControl')
jest.mock('./AssistantOptions/helper', () => ({
    calculateAmountOfOptionButtons: () => 2,
    getAssistantLineData: () => ({
        assistant: mockAssistant,
        assistantProject: mockProject,
        assistantProjectId: mockProject.id,
    }),
}))

describe('AssistantLine edit control', () => {
    beforeEach(() => {
        mockState = {
            isMiddleScreen: false,
            smallScreenNavigation: false,
            defaultAssistant: mockAssistant,
            loggedUser: { defaultProjectId: mockProject.id },
            selectedProjectIndex: 0,
            loggedUserProjects: [mockProject],
        }
    })

    it('shows a compact edit button and keeps its press out of the collapse handler', () => {
        const onEditAssistant = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(
                <AssistantLine
                    showEditAssistantButton
                    onEditAssistant={onEditAssistant}
                    projectOverride={mockProject}
                />
            )
        })

        const button = tree.root
            .findAllByType(TouchableOpacity)
            .find(item => item.props.accessibilityLabel === 'Edit assistant')
        const event = { preventDefault: jest.fn(), stopPropagation: jest.fn() }
        act(() => button.props.onPress(event))

        expect(button.findByType('Icon').props.name).toBe('edit-2')
        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(onEditAssistant).toHaveBeenCalled()
    })

    it('does not show the edit control by default', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantLine projectOverride={mockProject} />)
        })

        expect(tree.root.findAllByProps({ accessibilityLabel: 'Edit assistant' })).toHaveLength(0)
    })
})

describe('AssistantLine switch control (AT-2430)', () => {
    beforeEach(() => {
        mockState = {
            isMiddleScreen: false,
            smallScreenNavigation: false,
            defaultAssistant: mockAssistant,
            loggedUser: { defaultProjectId: mockProject.id },
            selectedProjectIndex: 0,
            loggedUserProjects: [mockProject],
        }
    })

    const assistantSwitch = {
        groups: [{ projectId: mockProject.id, projectName: 'Project', options: [] }],
        grouped: false,
        activeProjectId: mockProject.id,
        activeAssistantId: mockAssistant.uid,
        onSelect: jest.fn(),
    }

    it('renders no switch control unless a scope is given', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantLine projectOverride={mockProject} />)
        })

        expect(tree.root.findAllByType('AssistantSwitchControl')).toHaveLength(0)
    })

    it('hands the whole switch scope to the control, expanded and collapsed alike', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantLine projectOverride={mockProject} assistantSwitch={assistantSwitch} />)
        })

        const expanded = tree.root.findByType('AssistantSwitchControl')
        expect(expanded.props.groups).toBe(assistantSwitch.groups)
        expect(expanded.props.onSelect).toBe(assistantSwitch.onSelect)
        expect(expanded.props.activeAssistantId).toBe(mockAssistant.uid)
        // Expanded is the default layout, so it must NOT ask for the collapsed styling.
        expect(expanded.props.collapsed).toBeUndefined()

        act(() => {
            tree.update(
                <AssistantLine projectOverride={mockProject} assistantSwitch={assistantSwitch} startCollapsed={true} />
            )
        })

        const collapsed = tree.root.findByType('AssistantSwitchControl')
        expect(collapsed.props.collapsed).toBe(true)
        expect(collapsed.props.groups).toBe(assistantSwitch.groups)
    })
})
