/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectMembersHeader from '../../../components/ProjectDetailedView/ProjectMembers/ProjectMembersHeader'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeLoggedUserProjects } from '../../../redux/actions'

describe('ProjectMembersHeader component', () => {
    describe('ProjectMembersHeader snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(storeLoggedUserProjects([{ name: 'My Project', userIds: [] }]))
            const tree = renderer.create(<ProjectMembersHeader amount={0} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
