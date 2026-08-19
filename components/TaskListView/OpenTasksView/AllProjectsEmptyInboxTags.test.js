import React from 'react'
import renderer from 'react-test-renderer'
import { Text } from 'react-native'
import { useSelector } from 'react-redux'

import AllProjectsEmptyInboxTags from './AllProjectsEmptyInboxTags'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))
jest.mock('../../Tags/ProjectTag', () => 'ProjectTag')
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectsByType: jest.fn(),
    sortProjects: jest.fn(projects => projects),
    checkIfLoggedUserIsAdminUserInGuide: jest.fn(() => false),
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectsSettings', () => ({
    PROJECT_TYPE_ACTIVE: 'active',
    PROJECT_TYPE_GUIDE: 'guide',
}))

describe('AllProjectsEmptyInboxTags', () => {
    const activeProject = { id: 'project-1', name: 'Active' }
    const guideProject = { id: 'project-2', name: 'Guide' }

    beforeEach(() => {
        jest.clearAllMocks()
        ProjectHelper.sortProjects.mockImplementation(projects => projects)
        ProjectHelper.checkIfLoggedUserIsAdminUserInGuide.mockReturnValue(false)
        ProjectHelper.getProjectsByType.mockImplementation((projects, user, type) =>
            type === 'active' ? [activeProject] : [guideProject]
        )
        useSelector.mockImplementation(selector =>
            selector({ loggedUser: { uid: 'user-1' }, loggedUserProjects: [activeProject, guideProject] })
        )
    })

    // AT-2359: the empty all-projects inbox lists the projects as a shortcut, but
    // the "Or open one of your projects" prompt above them was removed — the
    // project tags speak for themselves under the primary "Add task" button.
    it('renders the project tags without any prompt text', () => {
        const tags = renderer.create(<AllProjectsEmptyInboxTags />)

        expect(tags.root.findAllByType('ProjectTag').map(tag => tag.props.project.id)).toEqual([
            'project-1',
            'project-2',
        ])
        expect(tags.root.findAllByType(Text)).toHaveLength(0)
    })
})
