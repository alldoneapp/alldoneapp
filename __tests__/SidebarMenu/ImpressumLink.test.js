import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import ImpressumLink from '../../components/SidebarMenu/ImpressumLink'
import store from '../../redux/store'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

// Overriding getState wholesale left the component without the rest of the
// state it reads, themeName among it. Keep the real state and layer the few
// fields this suite cares about on top.
const realGetState = store.getState.bind(store)

beforeEach(() => {
    jest.mock('../../URLSystem/URLTrigger')

    store.getState = jest.fn(() => ({
        ...realGetState(),
        showSideBarVersionRefresher: true,
        alldoneVersion: { major: 5, minor: 3 },
        alldoneNewVersion: { major: 5, minor: 3, isMandatory: false },
    }))
})

afterEach(() => {
    store.getState = realGetState
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
