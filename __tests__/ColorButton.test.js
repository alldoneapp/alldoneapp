/**
 * @jest-environment jsdom
 */
import React from 'react'
import ColorButton from '../components/AddNewProject/ColorButton'
import store from '../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'
import { Platform } from 'react-native'

jest.mock('firebase', () => ({ firestore: {} }))

describe('ColorButton component', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    describe('ColorButton empty snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ColorButton />
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
                        <ColorButton />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
