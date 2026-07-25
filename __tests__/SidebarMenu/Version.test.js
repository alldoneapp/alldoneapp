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

beforeEach(() => {
    jest.mock('../../redux/store')

    mockStatic = jest.fn()
    mockStatic.mockReturnValue({
        showSideBarVersionRefresher: true,
        alldoneVersion: { major: 5, minor: 3 },
        alldoneNewVersion: { major: 5, minor: 3, isMandatory: false },
    })
    store.getState = mockStatic
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
        it('test', async () => {
            const { findByTestId } = render(<Version />)
            const button = await findByTestId('refreshButton')
            fireEvent.press(button)
        })
    })
})
