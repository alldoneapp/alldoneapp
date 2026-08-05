/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Platform } from 'react-native'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'

import UserProperties from '../../../components/UserDetailedView/UserProperties/UserProperties'
import store from '../../../redux/store'
import { seedLoggedUser, seedProjectUsers, seedProjects } from '../../../testUtils/seedStore'

// The follower/contact effects really run under RNW and reach the
// uninitialized firestore `db`. Object.create keeps the real modules on the
// prototype without eagerly resolving their circular re-exports.
jest.mock('../../../utils/backends/firestore', () =>
    Object.assign(Object.create(jest.requireActual('../../../utils/backends/firestore')), {
        watchFollowers: jest.fn(),
        unwatch: jest.fn(),
    })
)
jest.mock('../../../utils/backends/Contacts/contactsFirestore', () =>
    Object.assign(Object.create(jest.requireActual('../../../utils/backends/Contacts/contactsFirestore')), {
        getContactData: jest.fn(() => Promise.resolve(null)),
    })
)

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

// The component is a function taking { user, project } now. The role and
// company modals it used to expose as instance methods are internal state, so
// this covers what a caller can actually observe.
// setSharedData stamps `index` on the copy it stores, not on this literal,
// and helpers look the project up by index, so it is set here too.
const project = { id: 'seeded-project-0', index: 0, name: 'My project', userIds: [], usersData: {} }
const user = { uid: 'user-1', displayName: 'Martina Muller', noteIdsByProject: {} }

beforeAll(() => {
    store.dispatch([
        ...seedProjects([project]),
        ...seedProjectUsers([[user]]),
        seedLoggedUser({ projectIds: [project.id] }),
    ])
})

const render = (props = {}) =>
    renderer.create(
        <Provider store={store}>
            <UserProperties user={user} project={project} {...props} />
        </Provider>
    )

describe('UserProperties component', () => {
    it('should render correctly', () => {
        expect(render().toJSON()).toMatchSnapshot()
    })

    it('should unmount correctly', () => {
        const tree = render()

        expect(() => tree.unmount()).not.toThrow()
    })

    it('renders its rows as pressable', () => {
        const tree = render()

        const pressables = tree.root.findAll(node => typeof node.props.onPress === 'function')

        expect(pressables.length).toBeGreaterThan(0)
    })
})
