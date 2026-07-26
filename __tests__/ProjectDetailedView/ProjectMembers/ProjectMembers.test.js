/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import { seedProjectUsers, seedProjects } from '../../../testUtils/seedStore'
import ProjectMembers from '../../../components/ProjectDetailedView/ProjectMembers/ProjectMembers'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'

// seedProjects gives the first project this id.
const seededProject = { id: 'seeded-project-0', name: 'My Project' }

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('ProjectMembers component', () => {
    beforeEach(() => {
        store.dispatch([
            ...seedProjects([{ name: 'My Project', userIds: [], usersData: [] }]),
            ...seedProjectUsers([[{ displayName: 'pepitp' }, { displayName: 'baltazar' }]]),
        ])
    })

    describe('ProjectMembers snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectMembers project={seededProject} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
