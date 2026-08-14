/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import { seedProjectUsers, seedProjects } from '../../testUtils/seedStore'
import SelectUserModal from '../../components/WorkflowView/SelectUserModal'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'
import store from '../../redux/store'

jest.mock('react-tiny-popover')

describe('SelectUserModal component', () => {
    const projectIndex = '0'
    const currentUser = { uid: '1', displayName: 'asd' }
    const projects = [{ id: '2' }]
    store.dispatch([...seedProjectUsers([[{ uid: '0', displayName: 'a' }]]), ...seedProjects(projects)])

    describe('SelectUserModal snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(
                <Provider store={store}>
                    <SelectUserModal currentUser={currentUser} projectIndex={projectIndex} />
                </Provider>
            )
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
