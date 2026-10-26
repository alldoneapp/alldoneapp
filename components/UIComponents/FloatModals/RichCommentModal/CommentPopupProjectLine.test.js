import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import CommentPopupProjectLine from './CommentPopupProjectLine'

let mockState
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall', () => 'ColoredCircleSmall')
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getProjectColorById: id => (id === 'task-project' ? '#FF0000' : '#0000FF') },
}))

const render = projectId => {
    let tree
    act(() => {
        tree = renderer.create(<CommentPopupProjectLine projectId={projectId} />)
    })
    return tree
}

describe('CommentPopupProjectLine (AT-2867)', () => {
    beforeEach(() => {
        mockState = {
            // The selected project is deliberately a different one: the line must follow the
            // popup's (task's) project, not whatever project the user is currently looking at.
            selectedProjectIndex: 0,
            loggedUserProjects: [{ id: 'selected-project', name: 'Selected project' }],
            loggedUserProjectsMap: {
                'selected-project': { id: 'selected-project', name: 'Selected project', index: 0 },
                'task-project': { id: 'task-project', name: 'JTL Software', color: '#FF0000', index: 1 },
                guide: { id: 'guide', name: 'A guide', parentTemplateId: 'template-1', index: 2 },
            },
        }
    })

    it("names the task's own project with its colour", () => {
        const tree = render('task-project')

        expect(tree.root.findByType(Text).props.children).toBe('JTL Software')
        expect(tree.root.findByType('ColoredCircleSmall').props.color).toBe('#FF0000')
        expect(tree.root.findByProps({ testID: 'comment-popup-project-line' }).props.accessibilityLabel).toBe(
            'Project: JTL Software'
        )
    })

    it('truncates a long project name to one line instead of wrapping under the close buttons', () => {
        mockState.loggedUserProjectsMap['task-project'].name = 'A'.repeat(200)
        const tree = render('task-project')
        const text = tree.root.findByType(Text)
        const container = tree.root.findByProps({ testID: 'comment-popup-project-line' })

        expect(text.props.numberOfLines).toBe(1)
        expect(text.props.ellipsizeMode).toBe('tail')
        expect(container.props.style.paddingRight).toBeGreaterThanOrEqual(48)
    })

    it('marks a guide like the sidebar does', () => {
        const tree = render('guide')

        expect(tree.root.findByType('ColoredCircleSmall').props.isGuide).toBe(true)
    })

    it('renders nothing for a project the user does not have', () => {
        expect(render('unknown-project').toJSON()).toBeNull()
        expect(render(undefined).toJSON()).toBeNull()
    })
})
