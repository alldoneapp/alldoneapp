import React from 'react'
import NavigationBarItem from '../components/NavigationBar/NavigationBarItem'
import store from '../redux/store'

import renderer from 'react-test-renderer'
import { DV_TAB_ROOT_TASKS } from '../utils/TabNavigationConstants'

jest.mock('firebase', () => ({ firestore: {} }))

window.location = { origin: '' }

describe('NavigationBarItem component', () => {
    describe('NavigationBarItem web snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<NavigationBarItem expandPicker={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('NavigationBarItem mobile snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<NavigationBarItem isMobile expandPicker={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('NavigationBarItem other tests', () => {
        it('should set selected nav item', () => {
            const tree = renderer.create(
                <NavigationBarItem isMobile expandPicker={() => {}}>
                    Tasks
                </NavigationBarItem>
            )
            const instance = tree.getInstance()
            instance.onPress()
            expect(store.getState().selectedNavItem).toEqual(DV_TAB_ROOT_TASKS)
        })
    })
})
