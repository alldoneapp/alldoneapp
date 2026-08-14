import React from 'react'
import { seedProjects } from '../../testUtils/seedStore'
import { ESTIMATION_TYPE_TIME } from '../../utils/EstimationHelper'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import EstimationModal from '../../components/UIComponents/FloatModals/EstimationModal/EstimationModal'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useStore: jest.fn().mockImplementation(() => ({
        getState: () => {},
    })),
}))

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task' }

// The estimation helpers look the project up in the store rather than take
// it from props, so it has to exist before anything renders.
beforeAll(() => {
    store.dispatch(seedProjects([{ id: dummyProjectId, name: 'My project', estimationType: ESTIMATION_TYPE_TIME }]))
})

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
