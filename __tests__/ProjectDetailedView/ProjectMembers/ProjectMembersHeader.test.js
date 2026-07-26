/**
 * @jest-environment jsdom
 */

import React from 'react'
import { seedProjects } from '../../../testUtils/seedStore'
import ProjectMembersHeader from '../../../components/ProjectDetailedView/ProjectMembers/ProjectMembersHeader'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'

describe('ProjectMembersHeader component', () => {
    describe('ProjectMembersHeader snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch([...seedProjects([{ name: 'My Project', userIds: [] }])])
            const tree = renderer.create(<ProjectMembersHeader amount={0} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
