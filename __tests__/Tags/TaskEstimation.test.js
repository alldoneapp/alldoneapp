/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Platform } from 'react-native'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'

import TaskEstimation from '../../components/Tags/TaskEstimation'
import store from '../../redux/store'
import { setSharedData } from '../../redux/actions'
import { ESTIMATION_TYPE_TIME } from '../../utils/EstimationHelper'

// The tag reads MyPlatform.osType, which only consults window.navigator off the
// mobile path. The react-native preset reports ios, so without this the helper
// is handed `false` and throws before anything renders.
Platform.OS = 'web'

const projectId = '-Asd'
const task = { id: '-Sda', name: 'My Task', estimations: {} }

// The estimation helpers resolve the project straight out of the store rather
// than from props, so the project has to exist before the tag renders.
beforeAll(() => {
    store.dispatch(
        setSharedData({ id: projectId, name: 'My project', estimationType: ESTIMATION_TYPE_TIME }, [], [], [], [])
    )
})

const renderTag = () =>
    renderer.create(
        <Provider store={store}>
            <TaskEstimation projectId={projectId} task={task} />
        </Provider>
    )

describe('Task Estimation Tag component', () => {
    it('should render correctly', () => {
        expect(renderTag().toJSON()).toMatchSnapshot()
    })

    it('should unmount correctly', () => {
        const tree = renderTag()

        expect(() => tree.unmount()).not.toThrow()
    })
})
