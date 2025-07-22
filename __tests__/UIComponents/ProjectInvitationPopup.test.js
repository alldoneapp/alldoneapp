import React from 'react'

import renderer from 'react-test-renderer'
import ProjectInvitationPopup from '../../components/UIComponents/ProjectInvitation/ProjectInvitationPopup'

jest.mock('firebase', () => ({ firestore: {} }));

describe('ProjectInvitationPopup component', () => {
    describe('ProjectInvitationPopup snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<ProjectInvitationPopup />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function hidePopup snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(<ProjectInvitationPopup />)

            tree.getInstance().hidePopup()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
