/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectMemberItem from '../../../components/ProjectDetailedView/ProjectMembers/ProjectMemberItem'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeLoggedUserProjects } from '../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT } from '../../../components/UIComponents/ConfirmPopup'

const dummyUser = {
    uid: 'asd',
    photoURL: 'http://path.to.photo',
    displayName: 'Pepito',
}
const projects = [
    {
        name: 'My Project',
        userIds: [],
        usersData: {
            '-Asd1': { role: 'role1' }
        }
    }
]

describe('ProjectMemberItem component', () => {
    beforeEach(() => {
        store.dispatch(storeLoggedUserProjects(loggedUserProjects))
    })

    describe('ProjectMemberItem snapshot test', () => {
        xit('should render correctly', () => {
            store.dispatch(storeLoggedUserProjects(projects))
            const tree = renderer.create(<ProjectMemberItem user={dummyUser} projectIndex={0} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('ProjectMemberItem functions test', () => {
        xit('function onKickPress', () => {
            store.dispatch(storeLoggedUserProjects(projects))
            const tree = renderer.create(<ProjectMemberItem user={dummyUser} projectIndex={0} />)
            const instance = tree.getInstance()

            instance.onKickPress()

            const storeState = store.getState()
            expect(storeState.showConfirmPopup.visible).toBeTruthy()
            expect(storeState.showConfirmPopup.action.trigger).toEqual(CONFIRM_POPUP_TRIGGER_KICK_USER_FROM_PROJECT)
            expect(storeState.showConfirmPopup.action.object.navigation).toEqual('Tasks')
        })
    })
})
