/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import Version from '../../components/SidebarMenu/Version'
import store from '../../redux/store'
import { render, fireEvent } from '@testing-library/react-native'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

jest.mock('firebase', () => ({ firestore: {} }))

// Overriding getState wholesale left the component without the rest of the
// state it reads, themeName among it. Keep the real state and layer the few
// fields this suite cares about on top.
const realGetState = store.getState.bind(store)

beforeEach(() => {
    jest.mock('../../redux/store')

    // react-redux 8 reads the state through useSyncExternalStore, which
    // requires getSnapshot to return a stable reference - building a fresh
    // object on every getState() call loops the renderer until it OOMs.
    const stubbedState = {
        ...realGetState(),
        showSideBarVersionRefresher: true,
        alldoneVersion: { major: 5, minor: 3 },
        alldoneNewVersion: { major: 5, minor: 3, isMandatory: false },
    }
    store.getState = jest.fn(() => stubbedState)
})

afterEach(() => {
    store.getState = realGetState
})

describe('Version component', () => {
    describe('Version snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <Version />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Clicking the resfresh button works', () => {
        it('test', () => {
            // getByTestId only matches host elements, and react-native-web
            // hosts are DOM tags that carry data-testid instead of testID -
            // match the touchable component by prop instead.
            const { UNSAFE_getByProps } = render(
                <Provider store={store}>
                    <Version />
                </Provider>
            )
            const button = UNSAFE_getByProps({ testID: 'refreshButton' })
            fireEvent.press(button)
        })
    })
})
