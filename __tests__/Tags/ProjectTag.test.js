/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import ProjectTag from '../../components/Tags/ProjectTag'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'
jest.mock('../../components/TaskListView/Utils/TasksHelper')

import renderer from 'react-test-renderer'

const dummyProject = { id: '-Asd', color: '#fff000', name: 'Project X' }

describe('Project tag component', () => {
    describe('Project tag snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectTag project={dummyProject} style={{ marginHorizontal: 16 }} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
