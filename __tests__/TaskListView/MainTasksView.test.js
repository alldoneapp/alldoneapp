/**
 * @jest-environment jsdom
 */

import React from 'react'
import MainTasksView from '../../components/TaskListView/MainTasksView'
import store from '../../redux/store'
import { Provider } from 'react-redux'
import {
    setAmountTasksByProjects,
    storeCurrentUser,
    storeLoggedUser,
    storeLoggedUserProjects,
    storeSelectedProjectUsers,
    toggleSmallScreen
} from '../../redux/actions'
import { Platform } from 'react-native'

import renderer from 'react-test-renderer'
import { DefaultAmountTasks } from '../../__mocks__/MockData/TasksView/DefaultAmountTasks'

const userId = 'C08CK8x1I5YS2lxVixuLHaF3SrA3'
let loggedUserProjects = [
    { id: '-Asd', name: 'My project', color: '#0055ff' },
    { id: '-Asd2', name: 'My project 2', color: '#0055ff' },
]
let currentUser = { uid: userId, photoURL: 'http:path.to.photo', displayName: 'Chicho' }

const navigationMock = {
    openDrawer: () => { },
}

describe('MainTasksView component', () => {
    //Uncomment the the following lines if you need to add more tests in the describe
    //block. React Native Animated needs its internal timers mocked. See: https://github.com/facebook/jest/issues/6434
    //beforeEach(() => {
    jest.useFakeTimers()
    //});

    beforeEach(() => {
        store.dispatch([
            storeLoggedUserProjects(loggedUserProjects),
            storeSelectedProjectUsers([currentUser]),
            storeCurrentUser(currentUser),
            storeLoggedUser(currentUser),
            setAmountTasksByProjects(DefaultAmountTasks)
        ])
    })

    describe('MainTasksView snapshot test', () => {
        it('should render correctly', async () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <MainTasksView navigation={navigationMock} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('check the unmount action', () => {
            const tree = renderer.create(
                <Provider store={store}>
                    <MainTasksView navigation={navigationMock} />
                </Provider>
            )
            tree.unmount()
        })

        it('should render correctly when the platform is web', () => {
            Platform.OS = 'web'
            const tree = renderer.create(
                <Provider store={store}>
                    <MainTasksView navigation={navigationMock} />
                </Provider>
            )
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function onLayoutChange snapshot test', () => {
        xit('should render correctly', async () => {
            const tree = renderer.create(<MainTasksView navigation={navigationMock} />)
            expect(tree.toJSON()).toMatchSnapshot()

            const layout = { nativeEvent: { layout: { width: 500 } } }
            tree.getInstance().onLayoutChange(layout)
            expect(tree.toJSON()).toMatchSnapshot()

            store.dispatch(toggleSmallScreen(true))
            tree.getInstance().onLayoutChange(layout)
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
