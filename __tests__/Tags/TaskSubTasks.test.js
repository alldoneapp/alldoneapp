/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import TaskSubTasks from '../../components/Tags/TaskSubTasks'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

describe('Task Sub Tasks tag component', () => {
    describe('Task Estimation snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskSubTasks amountOfSubTasks={0} style={{ marginLeft: 10 }} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 1', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskSubTasks amountOfSubTasks={1} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('should render correctly for amount 2', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskSubTasks amountOfSubTasks={2} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
