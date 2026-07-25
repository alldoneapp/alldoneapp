/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import TaskRecurrence from '../../components/Tags/TaskRecurrence'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

const task = { id: '-Asd', name: 'My task', recurrence: { type: 'never' } }

describe('TaskRecurrence component', () => {
    describe('TaskRecurrence empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <TaskRecurrence projectId={'-Asd'} task={task} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
