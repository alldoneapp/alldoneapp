import React from 'react'
import renderer from 'react-test-renderer'

let mockExpanded = true

jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({
            selectedProjectIndex: 0,
            loggedUser: { themeName: 'default' },
            projectChatNotifications: { 'project-1': { totalFollowed: 7 } },
        }),
}))
jest.mock('../../Collapsible/UseCollapsibleSidebar', () => () => ({ expanded: mockExpanded }))
jest.mock('../../../../Themes/Themes', () => ({
    COLORS_THEME_MODERN: 'modern',
    getTheme: () => ({ marker: () => 'blue' }),
}))
jest.mock('../../Themes', () => ({ Themes: {} }))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedProject: () => false,
}))
jest.mock('./ColoredCircleAmount', () => 'ColoredCircleAmount')
jest.mock('./ProjectLetter', () => 'ProjectLetter')

const ProjectItemIcon = require('./ProjectItemIcon').default

describe('sidebar project icon', () => {
    beforeEach(() => {
        mockExpanded = true
    })

    it('keeps the project marker without a chat unread badge in the expanded sidebar', () => {
        const component = renderer.create(
            <ProjectItemIcon projectId={'project-1'} projectColor={'blue'} highlight={false} isGuide={false} />
        )

        expect(component.root.findAllByType('Text')).toHaveLength(0)
        expect(component.root.findAllByType('ColoredCircleAmount')).toHaveLength(0)
    })

    it('keeps the project marker without a chat unread badge in the collapsed sidebar', () => {
        mockExpanded = false

        const component = renderer.create(
            <ProjectItemIcon projectId={'project-1'} projectColor={'blue'} highlight={false} isGuide={false} />
        )

        expect(component.root.findAllByType('Text')).toHaveLength(0)
        expect(component.root.findAllByType('ColoredCircleAmount')).toHaveLength(1)
    })
})
