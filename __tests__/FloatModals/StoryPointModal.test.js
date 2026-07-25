import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import EstimationModal from '../../components/UIComponents/FloatModals/EstimationModal/EstimationModal'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }))

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useStore: jest.fn().mockImplementation(() => ({
        getState: () => {},
    })),
}))

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task' }

describe('StoryPointModal component', () => {
    describe('StoryPointModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <EstimationModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
