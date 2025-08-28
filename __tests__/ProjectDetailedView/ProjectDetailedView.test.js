/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectDetailedView from '../../components/ProjectDetailedView/ProjectDetailedView'
import renderer from 'react-test-renderer'
import store from '../../redux/store'
import { storeLoggedUserProjects, setProjectsUsers } from '../../redux/actions'

const navigation = {
    getParam: param => {
        if (param === 'projectIndex') {
            return 0
        }
        return {}
    },
}

describe('ProjectDetailedView component', () => {
    it('should render correctly', () => {
        const projects = [{ name: 'My Project', userIds: [] }]
        store.dispatch(storeLoggedUserProjects(projects))
        store.dispatch(setProjectsUsers(projects))
        const tree = renderer.create(<ProjectDetailedView navigation={navigation} />).toJSON();
        expect(tree).toMatchSnapshot()
    })
})
