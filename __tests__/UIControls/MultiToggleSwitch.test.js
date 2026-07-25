import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import MultiToggleSwitch from '../../components/UIControls/MultiToggleSwitch/MultiToggleSwitch'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }))

let options = [
    { icon: 'square', text: 'Open' },
    { icon: 'clock', text: 'Pending' },
    { icon: 'square-checked-gray', text: 'Done' },
]

describe('MultiToggleSwitch component', () => {
    describe('MultiToggleSwitch empty snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <MultiToggleSwitch options={options} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
