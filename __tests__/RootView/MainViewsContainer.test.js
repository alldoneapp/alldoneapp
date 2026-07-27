import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import MainViewsContainer from '../../components/RootView/MainViewsContainer'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))
jest.mock('../../components/TaskListView/MainTasksView', () => 'MainTasksView')
jest.mock('../../components/ContactsView/ContactsView', () => 'ContactsView')
jest.mock('../../components/GoalsView/GoalsView', () => 'GoalsView')
jest.mock('../../components/Feeds/RootViewFeedsGlobalProject', () => 'RootViewFeedsGlobalProject')
jest.mock('../../components/NotesView/NotesView', () => 'NotesView')
jest.mock('../../components/ChatsView/ChatsView', () => 'ChatsView')
jest.mock('../../components/UIControls/CustomScrollView', () => 'CustomScrollView')
jest.mock('../../components/RootView/RootSectionNavigation', () => 'RootSectionNavigation')
jest.mock('../../components/SidebarMenu/Collapsible/UseCollapsibleSidebar', () => () => ({ overlay: false }))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: () => false,
}))

const renderWithState = responsiveState => {
    const state = {
        selectedSidebarTab: DV_TAB_ROOT_TASKS,
        selectedProjectIndex: 0,
        showFloatPopup: 1,
        ...responsiveState,
    }
    useSelector.mockImplementation(selector => selector(state))

    const tree = renderer.create(<MainViewsContainer />)
    return tree.root.findByType('CustomScrollView')
}

describe('MainViewsContainer popup scroll lock', () => {
    test.each([
        ['phone', { smallScreen: true, smallScreenNavigation: true, isMiddleScreen: true }, false],
        ['tablet', { smallScreen: true, smallScreenNavigation: false, isMiddleScreen: true }, false],
        ['compact desktop', { smallScreen: true, smallScreenNavigation: false, isMiddleScreen: false }, false],
        ['wide desktop', { smallScreen: false, smallScreenNavigation: false, isMiddleScreen: false }, true],
    ])('%s layout applies the expected scroll lock while a popup is counted', (_mode, state, expected) => {
        expect(renderWithState(state).props.scrollEnabled).toBe(expected)
    })

    test.each([
        ['phone', { smallScreen: true, smallScreenNavigation: true, isMiddleScreen: true }],
        ['tablet', { smallScreen: true, smallScreenNavigation: false, isMiddleScreen: true }],
        ['compact desktop', { smallScreen: true, smallScreenNavigation: false, isMiddleScreen: false }],
        ['wide desktop', { smallScreen: false, smallScreenNavigation: false, isMiddleScreen: false }],
    ])('%s layout scrolls after the popup count is released', (_mode, state) => {
        expect(renderWithState({ ...state, showFloatPopup: 0 }).props.scrollEnabled).toBe(true)
    })
})
