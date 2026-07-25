/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../../redux/store'
import { Platform } from 'react-native'
import ProjectsSettings from '../../../components/SettingsView/ProjectsSettings/ProjectsSettings'
import renderer from 'react-test-renderer'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

describe('ProjectsSettings component', () => {
    describe('ProjectsSettings snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectsSettings />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
