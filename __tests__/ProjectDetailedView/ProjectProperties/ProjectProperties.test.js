/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import { Platform } from 'react-native'
import { seedProjectUsers, seedProjects } from '../../../testUtils/seedStore'
import ProjectProperties from '../../../components/ProjectDetailedView/ProjectProperties/ProjectProperties'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeLoggedUser } from '../../../redux/actions'

// DescriptionField mounts the Quill editor, which needs a real editing area.
jest.mock('../../../components/TaskDetailedView/Properties/DescriptionField', () => 'DescriptionField')

// seedProjects gives the first project this id.
const seededProject = { id: 'seeded-project-0', name: 'My Project', guideProjectIds: [] }

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('ProjectProperties component', () => {
    beforeEach(() => {
        store.dispatch([
            ...seedProjects([{ name: 'My Project', userIds: [] }]),
            storeLoggedUser({ displayName: 'Pepe', archivedProjectIds: [] }),
            ...seedProjectUsers([[{}]]),
        ])
    })

    describe('ProjectProperties snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectProperties project={seededProject} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
