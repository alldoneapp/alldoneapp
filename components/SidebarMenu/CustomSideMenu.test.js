import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({ smallScreenNavigation: false, loggedUser: { isAnonymous: false, themeName: 'modern' } }),
}))
jest.mock('./LoggedUserSidebar/LoggedUserSidebar', () => () => 'logged user sidebar')
jest.mock('./AnonymousUserSidebar/AnonymousUserSidebar', () => () => 'anonymous sidebar')
jest.mock('./ProjectFolding/Common/CollapseButton', () => () => null)
jest.mock('./Backdrop', () => () => null)
jest.mock('./Collapsible/UseCollapsibleSidebar', () => () => ({ expanded: false, overlay: true }))
jest.mock('../../Themes/Themes', () => ({ getTheme: () => ({}) }))
jest.mock('./Themes/index', () => ({ Themes: {} }))
jest.mock('../../redux/actions', () => ({ setWebSideBarLayout: () => ({ type: 'layout' }) }))

import CustomSideMenu from './CustomSideMenu'
import { AnnaShellSidebarContext } from '../Anna/AnnaShellSidebarContext'

const mount = shellDrawsSidebar => {
    let tree
    act(() => {
        tree = renderer.create(
            <AnnaShellSidebarContext.Provider value={shellDrawsSidebar}>
                <CustomSideMenu navigation={{}} />
            </AnnaShellSidebarContext.Provider>
        )
    })
    return JSON.stringify(tree.toJSON())
}

// AT-3121: with the "Sections on top" sidebar and the chat open, AnnaShell draws the one sidebar left
// of the chat; the screens in its workspace leave theirs out.
describe('CustomSideMenu inside the assistant shell', () => {
    it('draws the sidebar where the shell does not', () => {
        expect(mount(false)).toContain('logged user sidebar')
    })

    it('leaves it out while the shell draws it', () => {
        expect(mount(true)).toBe('null')
    })
})
