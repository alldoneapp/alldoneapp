import React from 'react'
import { Provider } from 'react-redux'
import store from '../../../redux/store'
import { Platform } from 'react-native'
import SelectProjectModal from '../../../components/UIComponents/FloatModals/SelectProjectModal/SelectProjectModal'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }))

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            loggedUser: { id: '0' },
            screenDimensions: { height: 1024 },
        })
    }),
}))

describe('SelectProjectModal component', () => {
    const task = { id: 'id1', name: 'task1' }
    describe('SelectProjectModal snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <SelectProjectModal task={task} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
