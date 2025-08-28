/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectMembers from '../../../components/ProjectDetailedView/ProjectMembers/ProjectMembers'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { setProjectsUsers, storeLoggedUserProjects } from '../../../redux/actions'

describe('ProjectMembers component', () => {
    beforeEach(() => {
        store.dispatch([
            storeLoggedUserProjects([{ name: 'My Project', userIds: [], usersData: [] }]),
            setProjectsUsers([[{ displayName: 'pepitp' }, { displayName: 'baltazar' }]]),
        ])
    })

    describe('ProjectMembers snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ProjectMembers projectIndex={0} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
