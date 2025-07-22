import React from 'react'
import AllProjects from '../../components/SidebarMenu/ProjectFolding/AllProjects'
import NavigationService from '../../utils/NavigationService'
import store from '../../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { Platform } from 'react-native'
import { hideSideMenuUser } from '../../redux/actions'
import { ALL_PROJECTS_INDEX } from '../../components/SettingsView/ProjectsSettings/ProjectHelper'

jest.mock('firebase', () => ({ firestore: {} }));

describe('AllProjects component', () => {
    describe('AllProjects empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <AllProjects />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('AllProjects methods', () => {
        xit('should switch projects when pressed', () => {
            const dispatchMock = jest.fn()
            const mockNavigatorRef = {
                dispatch: dispatchMock,
            }
            NavigationService.setTopLevelNavigator(mockNavigatorRef)

            const tree = renderer.create(<AllProjects></AllProjects>)
            const instance = tree.getInstance()
            instance.onPress()

            const storeState = store.getState()
            expect(storeState.hiddenSideMenuUser).toEqual(false)
            expect(storeState.selectedProjectIndex).toEqual(ALL_PROJECTS_INDEX)
            expect(storeState.currentUser).toEqual({})
        })

        xit('should route correctly', () => {
            Platform.OS = 'web'
            store.dispatch(hideSideMenuUser())
            const tree = renderer.create(<AllProjects></AllProjects>)
            const instance = tree.getInstance()
            instance.render()
        })
    })
})
