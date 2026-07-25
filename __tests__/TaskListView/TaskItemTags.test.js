/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import renderer from 'react-test-renderer'
import TaskItemTags from '../../components/TaskListView/TaskItemTags'
import { Text } from 'react-native'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('TaskItemTags component', () => {
    describe('TaskItemTags snapshot test', () => {
        it('should render correctly', async () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskItemTags amountTags={5}>
                            <Text>Some text</Text>
                        </TaskItemTags>
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
