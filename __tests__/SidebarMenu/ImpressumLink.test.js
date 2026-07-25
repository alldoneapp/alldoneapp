import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import ImpressumLink from '../../components/SidebarMenu/ImpressumLink'
import store from '../../redux/store'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

jest.mock('firebase', () => ({ firestore: {} }))

beforeEach(() => {
    jest.mock('../../URLSystem/URLTrigger')

    mockStatic = jest.fn()
    mockStatic.mockReturnValue({
        showSideBarVersionRefresher: true,
        alldoneVersion: { major: 5, minor: 3 },
        alldoneNewVersion: { major: 5, minor: 3, isMandatory: false },
    })
    store.getState = mockStatic
})

describe('ImpressumLink component', () => {
    describe('ImpressumLink snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ImpressumLink />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
