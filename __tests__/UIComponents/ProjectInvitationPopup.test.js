import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { setProjectInvitationData } from '../../redux/actions'
import { Platform } from 'react-native'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer from 'react-test-renderer'
import ProjectInvitationPopup from '../../components/UIComponents/ProjectInvitation/ProjectInvitationPopup'

// The popup reads the invited project and user out of
// showProjectInvitationPopup.data, which is null until an invitation is set.
beforeAll(() => {
    store.dispatch(
        setProjectInvitationData({
            project: { id: 'project-1', name: 'My project', isShared: false },
            user: { uid: 'user-1', displayName: 'Martina Muller' },
        })
    )
})

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
