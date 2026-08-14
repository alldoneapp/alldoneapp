/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../../redux/store'
import { seedLoggedUser } from '../../../testUtils/seedStore'
import { Platform } from 'react-native'
import ProjectItem from '../../../components/SettingsView/ProjectsSettings/ProjectItem'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

const dummyProject = {
    index: 0,
    id: '-LcRVRo6mhbC0oXCcZ2F',
    color: '#39CCCC',
    name: 'Another one',
    userIds: [
        'C08CK8x1I5YS2lxVixuLHaF3SrA3',
        'XVbBpdTHCfdo17bCqRrnGV85oJI2',
        's7jsNunUq6OQZttrrSyRO05MVFI2',
        'jsUAwtuUhfPrQwPFMtDyKAsdo7g1',
        'UUKU61Jc7ET8zE5ncN8F61HE19y1',
        'kTpVkeDAGMO7qIHvQ2uAbEUu0As1',
    ],
}

// getTypeOfProject reads the logged user's uid and project id lists straight
// from the store and dereferences them unguarded.
beforeAll(() => {
    store.dispatch(seedLoggedUser())
})

describe('ProjectItem component', () => {
    describe('ProjectItem snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectItem project={dummyProject} />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
