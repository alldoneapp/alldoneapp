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
