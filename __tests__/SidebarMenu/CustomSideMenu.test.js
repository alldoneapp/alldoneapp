import React from 'react'
import CustomSideMenu from '../../components/SidebarMenu/CustomSideMenu'
import store from '../../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { storeLoggedUser } from '../../redux/actions'

describe('CustomSideMenu component', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        // The snapshots show the simple sidebar; since AT-3122 a user without a stored mode gets "Anna on top".
        store.dispatch(storeLoggedUser({ displayName: 'Pepe el loco', sidebarNavigationMode: 'simple' }))
    })

    describe('CustomSideMenu empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <CustomSideMenu />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly when there is a task done', () => {
            store.dispatch({
                type: 'Store projects tasks',
                tasks: [[{ done: true }]],
            })
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <CustomSideMenu />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly when there is no task done', () => {
            store.dispatch({
                type: 'Store projects tasks',
                tasks: [[{ done: false }]],
            })
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <CustomSideMenu />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('check the unmount action', () => {
            const tree = renderer.create(
                <Provider store={store}>
                    <CustomSideMenu />
                </Provider>
            )
            tree.unmount()
        })
    })
})
