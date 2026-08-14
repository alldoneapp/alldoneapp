/**
 * @jest-environment jsdom
 */

import React from 'react'
import { seedProjects } from '../../testUtils/seedStore'
import { ESTIMATION_TYPE_TIME } from '../../utils/EstimationHelper'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import EstimationButton from '../../components/UIControls/EstimationButton'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'

// The estimation helpers look the project up in the store rather than take
// it from props, so it has to exist before anything renders.
beforeAll(() => {
    store.dispatch(seedProjects([{ id: '-Asd', name: 'My project', estimationType: ESTIMATION_TYPE_TIME }]))
})

describe('Task Estimation Button component', () => {
    describe('Task Estimation Button snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <EstimationButton
                            projectId={'-Asd'}
                            task={{ id: '-Sda', name: 'My Task', estimations: {}, stepHistory: ['open'] }}
                        />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
