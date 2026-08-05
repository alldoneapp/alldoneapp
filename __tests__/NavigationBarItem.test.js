import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import NavigationBarItem from '../components/NavigationBar/NavigationBarItem'
import store from '../redux/store'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'
import { DV_TAB_ROOT_TASKS } from '../utils/TabNavigationConstants'

window.location = { origin: '' }

describe('NavigationBarItem component', () => {
    describe('NavigationBarItem web snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <NavigationBarItem expandPicker={() => {}} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('NavigationBarItem mobile snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <NavigationBarItem isMobile expandPicker={() => {}} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
