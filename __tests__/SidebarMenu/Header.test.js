import React from 'react'
import Header from '../../components/SidebarMenu/Header'
import store from '../../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { ALL_PROJECTS_INDEX } from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'

jest.mock('../../utils/NavigationService')
jest.mock('firebase', () => ({ firestore: {} }))

const navigationMock = {
    closeDrawer: () => {},
}

describe('Header component', () => {
    describe('Header empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <Header />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Header methods', () => {
        it('Function onPressLogo should execute correctly', () => {
            const tree = renderer.create(<Header navigation={navigationMock} scrollToTop={() => {}} />)
            const instance = tree.getInstance()
            instance.onPressLogo()

            const storeState = store.getState()
            expect(storeState.hiddenSideMenuUser).toEqual(false)
            expect(storeState.selectedProjectIndex).toEqual(ALL_PROJECTS_INDEX)
            expect(storeState.selectedNavItem).toEqual(DV_TAB_ROOT_TASKS)
        })

        it('Function hideSideBar should execute correctly', () => {
            const tree = renderer.create(<Header navigation={navigationMock} />)
            const instance = tree.getInstance()
            instance.hideSideBar()

            const storeState = store.getState()
            expect(storeState.showWebSideBar.visible).toEqual(true)
        })
    })
})
