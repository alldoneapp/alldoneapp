/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../../redux/store'
import { Platform } from 'react-native'
import DueDate from '../../../components/TaskDetailedView/Properties/DueDate'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

describe('DueDate component', () => {
    describe('DueDate snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <DueDate projectId={'-Asd'} task={{ id: '-Sda', name: 'My task', dueDate: 1556028000 }} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
