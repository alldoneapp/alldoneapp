import React from 'react'
import PrivacyButton from '../components/AddNewProject/PrivacyButton'
import store from '../redux/store'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }))

describe('PrivacyButton component', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })
    describe('PrivacyButton empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <PrivacyButton />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly when is web', () => {
            Platform.OS = 'web'
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <PrivacyButton />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
