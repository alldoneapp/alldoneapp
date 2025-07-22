/**
 * @jest-environment jsdom
 */

import React from 'react'
import ContactDetailedView from '../../components/ContactDetailedView/ContactDetailedView'
import renderer from 'react-test-renderer'
import store from '../../redux/store'
import { setProjectsContacts, storeLoggedUserProjects } from '../../redux/actions'

const navigation = {
    getParam: (param, _) => {
        if (param === 'projectIndex') {
            return 0
        }
        if (param === 'contact') {
            return { role: '', photoURL: '' }
        }
        return {}
    },
}

describe('ContactDetailedView component', () => {
    it('should render correctly', () => {
        const projects = [{ name: 'My Project', userIds: [], usersData: [] }]
        const projectsContacts = [[]]
        store.dispatch(
            setProjectsContacts(projectsContacts),
            storeLoggedUserProjects(projects)
        )
        const tree = renderer.create(
            <ContactDetailedView navigation={navigation} />
        ).toJSON()
        expect(tree).toMatchSnapshot()
    })
})
