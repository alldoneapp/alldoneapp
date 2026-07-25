import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'
import ProjectInvitationPopup from '../../components/UIComponents/ProjectInvitation/ProjectInvitationPopup'

jest.mock('firebase', () => ({ firestore: {} }))

describe('ProjectInvitationPopup component', () => {
    describe('ProjectInvitationPopup snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectInvitationPopup />
                    </Provider>
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
