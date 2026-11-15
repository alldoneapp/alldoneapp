import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantLine from './AssistantLine'
import { ProjectSectionAccentContext } from '../../TaskListView/TaskHierarchy'
import { colors } from '../../styles/global'

const mockAssistant = { uid: 'assistant-1', displayName: 'Assistant' }
const mockProject = { id: 'project-1', assistantId: 'assistant-1' }
let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('./AssistantOptions/AssistantOptions', () => {
    const React = require('react')
    return props => React.createElement('AssistantOptions', props, props.headerControls)
})
jest.mock('./LastCommentArea', () => 'LastCommentArea')
jest.mock('../../AdminPanel/Assistants/AssistantAvatar', () => 'AssistantAvatar')
jest.mock('../../Icon', () => 'Icon')
jest.mock('./AssistantOptions/helper', () => ({
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

    it('shows a compact edit button and stops its press from propagating', () => {
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

    it('passes no switch scope unless one is given', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantLine projectOverride={mockProject} />)
        })

        expect(tree.root.findByType('AssistantOptions').props.assistantSwitch).toBeNull()
    })

    it('hands the whole switch scope to the header, where the name becomes the switcher', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantLine projectOverride={mockProject} assistantSwitch={assistantSwitch} />)
        })

        expect(tree.root.findByType('AssistantOptions').props.assistantSwitch).toBe(assistantSwitch)
    })
})

describe('AssistantLine project context background (AT-2537)', () => {
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

    const backgroundColorOf = tree =>
        StyleSheet.flatten(tree.root.findByProps({ testID: 'assistant-line' }).props.style).backgroundColor

    it('uses the milestone accent when rendered below a project line', () => {
        const projectAccentColor = '#FAEBEE'
        const tree = renderer.create(
            <ProjectSectionAccentContext.Provider value={projectAccentColor}>
                <AssistantLine projectOverride={mockProject} />
            </ProjectSectionAccentContext.Provider>
        )

        expect(backgroundColorOf(tree)).toBe(projectAccentColor)
        act(() => tree.unmount())
    })

    it('keeps the neutral background outside project context', () => {
        const tree = renderer.create(<AssistantLine projectOverride={mockProject} />)

        expect(backgroundColorOf(tree)).toBe(colors.Grey200)
        act(() => tree.unmount())
    })
})
