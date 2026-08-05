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

jest.mock('react-redux', () => {
    // The state has to be built once: the modal's project-filter effect depends
    // on the selected references, and a fresh object per selector call re-runs
    // it (and its setStates) on every render until the runner OOMs.
    const mockState = {
        loggedUser: {
            id: '0',
            uid: '0',
            projectIds: [],
            archivedProjectIds: [],
            templateProjectIds: [],
            guideProjectIds: [],
        },
        screenDimensions: { height: 1024 },
        // The picker filters the projects it can move the item to.
        loggedUserProjects: [],
    }
    return {
        ...jest.requireActual('react-redux'),
        useSelector: jest.fn().mockImplementation(fnc => fnc(mockState)),
    }
})

describe('SelectProjectModal component', () => {
    // The modal takes the item being moved - a { type, data } pair - rather
    // than a bare task, and titles itself from that type.
    const task = { id: 'id1', name: 'task1' }
    const item = { type: 'task', data: task }
    describe('SelectProjectModal snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <SelectProjectModal item={item} project={{ id: 'project-1', name: 'My project' }} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
