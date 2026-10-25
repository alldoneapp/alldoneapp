/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../../redux/store'
import { Platform } from 'react-native'
import { render, fireEvent } from '@testing-library/react'
import NotificationModalMandatory from '../../../components/UIComponents/FloatModals/NotificationModalMandatory'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

describe('NotificationModalMandatory component', () => {
    describe('NotificationModalMandatory snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <NotificationModalMandatory />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Clicking the resfresh button works', () => {
        it('test', () => {
            const { getByTestId } = render(
                <Provider store={store}>
                    <NotificationModalMandatory />
                </Provider>
            )
            fireEvent.click(getByTestId('refreshMandatory'))
        })
    })
})
