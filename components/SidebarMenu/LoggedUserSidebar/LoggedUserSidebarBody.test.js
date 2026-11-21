import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockState
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock(
    '../../UIControls/CustomScrollView',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../Themes/Themes', () => ({ getTheme: () => ({ scroll: {} }) }))
jest.mock('../Themes/index', () => ({ Themes: {} }))
jest.mock('../AllProjects/AllProjects', () => () => 'all projects')
jest.mock('../../AddNewProject/AddProject', () => () => 'add project')
jest.mock('../ActiveProjectsList', () => () => 'projects')
jest.mock('../GuideProjects', () => () => 'guides')
jest.mock('../SharedProjectsList', () => () => 'shared')
jest.mock('../FooterArea', () => () => 'footer')
jest.mock('../ArchivedProjects', () => () => 'archived')
jest.mock('../TemplateProjects', () => () => 'templates')
jest.mock('../SettingsItem', () => () => 'settings')
jest.mock('../AdminItem', () => () => 'admin')
jest.mock('../SectionsTop/SidebarAnnaButton', () => () => 'anna')

import LoggedUserSidebarBody from './LoggedUserSidebarBody'

const items = mode => {
    mockState = {
        loggedUser: { uid: 'u1', sidebarNavigationMode: mode, realTemplateProjectIds: [], themeName: 'modern' },
        administratorUser: { uid: 'admin' },
    }
    let tree
    act(() => {
        tree = renderer.create(<LoggedUserSidebarBody navigation={{}} expanded scrollView={{ current: null }} />)
    })
    return [].concat(tree.toJSON())
}

// AT-3121: the "Anna on top" sidebar has the general settings as the last row under All projects
// (AllProjectsSettings), so it leaves out the Settings item further down.
describe('the logged-in sidebar', () => {
    it('starts with Anna and leaves out the lower Settings item with Anna on top', () => {
        const shown = items('sectionsTop')
        expect(shown[0]).toBe('anna')
        expect(shown).not.toContain('settings')
    })

    it.each(['simple', 'advanced'])('keeps the Settings item in the %s sidebar', mode => {
        const shown = items(mode)
        expect(shown).toContain('settings')
        expect(shown).not.toContain('anna')
    })
})
