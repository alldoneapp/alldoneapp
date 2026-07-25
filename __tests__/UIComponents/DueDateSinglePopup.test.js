/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import DueDateSinglePopup from '../../components/UIComponents/DueDateSinglePopup'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

describe('DueDate Single Popup component', () => {
    describe('DueDate Single Popup snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <DueDateSinglePopup />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
