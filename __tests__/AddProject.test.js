/**
 * @jest-environment jsdom
 */

import React from 'react'
import AddProject from '../components/AddNewProject/AddProject'
import store from '../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { Platform } from 'react-native'

jest.mock('firebase', () => ({ firestore: {} }))

describe('AddProject component', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    describe('AddProject empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <AddProject />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly when the platform is web', () => {
            Platform.OS = 'web'
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <AddProject />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
