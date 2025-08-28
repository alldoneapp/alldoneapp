import React from 'react'
import CustomSideMenu from '../../components/SidebarMenu/CustomSideMenu'
import store from '../../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { storeLoggedUser } from '../../redux/actions'

jest.mock('firebase', () => ({ firestore: {} }));

describe('CustomSideMenu component', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        store.dispatch(storeLoggedUser({displayName: "Pepe el loco"}))
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

        it('check the updateState action', () => {
            const tree = renderer.create(
                <Provider store={store}>
                    <CustomSideMenu />
                </Provider>
            )
            tree.root.findByType(CustomSideMenu).instance.updateState()
        })
    })
})
