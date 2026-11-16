import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantLine from './AssistantLine'
import { ProjectSectionAccentContext } from '../../TaskListView/TaskHierarchy'
import { colors } from '../../styles/global'
import { AnnaSidebarCloseContext } from '../../Anna/AnnaChatNavigationContext'

const mockAssistant = { uid: 'assistant-1', displayName: 'Assistant' }
const mockProject = { id: 'project-1', assistantId: 'assistant-1' }
let mockState
// Counts real mounts of the (mocked) composer, to prove a layout switch does not remount it.
const mockOptionsMounts = { count: 0 }

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('./AssistantOptions/AssistantOptions', () => {
    const React = require('react')
    return props => {
        React.useEffect(() => {
            mockOptionsMounts.count += 1
        }, [])
        return React.createElement('AssistantOptions', props, props.headerControls)
    }
})
jest.mock('./AssistantLineSkeleton', () => 'AssistantLineSkeleton')
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

// AT-3034: the line tells its assistant-mode button which project's chat to open in the sidebar.
describe('AssistantLine assistant mode project', () => {
    beforeEach(() => {
        mockState = {
            isMiddleScreen: false,
            smallScreenNavigation: false,
            defaultAssistant: mockAssistant,
            loggedUser: { defaultProjectId: 'default-project' },
            selectedProjectIndex: -1,
            loggedUserProjects: [],
        }
    })
    const projectOf = element => {
        let tree
        act(() => {
            tree = renderer.create(element)
        })
        return tree.root.findByType('AssistantOptions').props.assistantModeProjectId
    }

    it("defaults to the line's own project", () => {
        expect(projectOf(<AssistantLine projectOverride={mockProject} />)).toBe('project-1')
    })

    it('uses "Automatic" (null) without a project, and honours an explicit choice', () => {
        expect(projectOf(<AssistantLine />)).toBeNull()
        expect(projectOf(<AssistantLine projectOverride={mockProject} assistantModeProjectId={null} />)).toBeNull()
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

// AT-3034 follow-up: with the assistant-mode sidebar open beside the app, the chat box lives in the
// sidebar, so the line shows only its Last comment card. The shell supplies a close action exactly
// while that desktop sidebar is visible (not on mobile, not in chat-only mode).
describe('AssistantLine while the assistant-mode sidebar is open', () => {
    beforeEach(() => {
        mockOptionsMounts.count = 0
        mockState = {
            isMiddleScreen: false,
            smallScreenNavigation: false,
            defaultAssistant: mockAssistant,
            loggedUser: { defaultProjectId: mockProject.id },
            selectedProjectIndex: 0,
            loggedUserProjects: [mockProject],
        }
    })

    const closeSidebar = () => {}
    const withSidebar = (element, close = closeSidebar) => (
        <AnnaSidebarCloseContext.Provider value={close}>{element}</AnnaSidebarCloseContext.Provider>
    )
    const render = element => {
        let tree
        act(() => {
            tree = renderer.create(element)
        })
        return tree
    }
    const flat = node => StyleSheet.flatten(node.props.style) || {}
    const composerOf = tree => tree.root.findAll(node => node.props.testID === 'assistant-line-composer')[0]
    const lineOf = tree => tree.root.findAll(node => node.props.testID === 'assistant-line')[0]

    it('hides the header and composer and shows only the Last comment card', () => {
        const tree = render(withSidebar(<AssistantLine projectOverride={mockProject} />))

        expect(flat(composerOf(tree)).display).toBe('none')
        // Still mounted inside the hidden wrapper, so nothing typed before is lost.
        expect(composerOf(tree).findAllByType('AssistantOptions')).toHaveLength(1)

        const lastComment = tree.root.findByType('LastCommentArea')
        expect(lastComment.props.withTopMargin).toBe(false)
        expect(StyleSheet.flatten(lastComment.props.style)).toEqual(
            expect.objectContaining({ backgroundColor: colors.Grey200, borderRadius: 4, marginBottom: 24 })
        )
        // The grey card (and its 160px minimum) moved onto the Last comment area.
        expect(flat(lineOf(tree)).backgroundColor).toBeUndefined()
        expect(flat(lineOf(tree)).minHeight).toBeUndefined()
        act(() => tree.unmount())
    })

    it('keeps the project accent and the board spacing on the Last comment card', () => {
        const tree = render(
            withSidebar(
                <ProjectSectionAccentContext.Provider value="#FAEBEE">
                    <AssistantLine projectOverride={mockProject} removeBottomSpace />
                </ProjectSectionAccentContext.Provider>
            )
        )

        expect(StyleSheet.flatten(tree.root.findByType('LastCommentArea').props.style)).toEqual(
            expect.objectContaining({ backgroundColor: '#FAEBEE', marginBottom: 0 })
        )
        act(() => tree.unmount())
    })

    it('shows the textbox as before without the sidebar (assistant mode off, mobile, chat only)', () => {
        const tree = render(<AssistantLine projectOverride={mockProject} />)

        expect(flat(composerOf(tree)).display).toBeUndefined()
        const lastComment = tree.root.findByType('LastCommentArea')
        expect(lastComment.props.withTopMargin).toBe(true)
        expect(lastComment.props.style).toBeNull()
        expect(flat(lineOf(tree))).toEqual(expect.objectContaining({ backgroundColor: colors.Grey200, minHeight: 160 }))
        act(() => tree.unmount())
    })

    it('does not remount the composer when the sidebar opens and closes, so a draft survives', () => {
        // The shell's provider is always there; only its value changes with the layout.
        const tree = render(withSidebar(<AssistantLine projectOverride={mockProject} />, null))
        expect(flat(composerOf(tree)).display).toBeUndefined()
        act(() => tree.update(withSidebar(<AssistantLine projectOverride={mockProject} />)))
        expect(flat(composerOf(tree)).display).toBe('none')
        act(() => tree.update(withSidebar(<AssistantLine projectOverride={mockProject} />, null)))
        expect(flat(composerOf(tree)).display).toBeUndefined()

        expect(mockOptionsMounts.count).toBe(1)
        act(() => tree.unmount())
    })

    it("keeps the assistant board's edit pencil reachable", () => {
        const onEditAssistant = jest.fn()
        const tree = render(
            withSidebar(
                <AssistantLine
                    projectOverride={mockProject}
                    showEditAssistantButton
                    onEditAssistant={onEditAssistant}
                />
            )
        )

        const visibleEdit = tree.root
            .findAllByType(TouchableOpacity)
            .filter(item => item.props.accessibilityLabel === 'Edit assistant')
            .filter(item => !composerOf(tree).findAll(node => node === item).length)
        expect(visibleEdit).toHaveLength(1)
        act(() => visibleEdit[0].props.onPress())
        expect(onEditAssistant).toHaveBeenCalled()
        act(() => tree.unmount())
    })

    it('loads as a Last comment ghost only', () => {
        mockState.defaultAssistant = null
        const open = render(withSidebar(<AssistantLine projectOverride={mockProject} />))
        expect(open.root.findByType('AssistantLineSkeleton').props.lastCommentOnly).toBe(true)
        act(() => open.unmount())

        const closed = render(<AssistantLine projectOverride={mockProject} />)
        expect(closed.root.findByType('AssistantLineSkeleton').props.lastCommentOnly).toBeUndefined()
        act(() => closed.unmount())
    })
})
