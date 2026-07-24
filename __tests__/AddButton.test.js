import React from 'react'
import AddButton from '../components/AddNewProject/AddButton'
import store from '../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { Platform } from 'react-native'

jest.mock('firebase', () => ({ firestore: {} }))

describe('AddButton component', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    describe('AddButton empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <AddButton />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('should render correctly when platform is web', () => {
            Platform.OS = 'web'
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <AddButton />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
