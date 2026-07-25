/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import DueDateModal from '../../components/UIComponents/FloatModals/DueDateModal/DueDateModal'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'
import moment from 'moment'

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task' }

describe('DueDateModal component', () => {
    describe('DueDateModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <DueDateModal
                            projectId={dummyProjectId}
                            task={task}
                            closePopover={() => {}}
                            delayClosePopover={() => {}}
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
