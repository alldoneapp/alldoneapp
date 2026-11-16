/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import Version from '../../components/SidebarMenu/Version'
import store from '../../redux/store'
import { render, fireEvent } from '@testing-library/react'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

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

    // A local emulator has no `info/version` record, so there is no release number to show.
    describe('without a version record', () => {
        it('says local instead of a made-up version', () => {
            // One stable object: react-redux re-renders forever on a fresh one per call (see above).
            const localState = { ...store.getState(), alldoneVersion: { major: 0, minor: 1, patch: 0, missing: true } }
            store.getState = jest.fn(() => localState)
            const { container } = render(
                <Provider store={store}>
                    <Version />
                </Provider>
            )
            expect(container.textContent).toContain('Alldone.app · local')
            expect(container.textContent).not.toContain('v0.1')
        })

        it('shows the release number when there is one', () => {
            const { container } = render(
                <Provider store={store}>
                    <Version />
                </Provider>
            )
            expect(container.textContent).toContain('Alldone.app v5.3')
        })
    })

    describe('Clicking the resfresh button works', () => {
        it('test', () => {
            const { getByTestId } = render(
                <Provider store={store}>
                    <Version />
                </Provider>
            )
            fireEvent.click(getByTestId('refreshButton'))
        })
    })
})
