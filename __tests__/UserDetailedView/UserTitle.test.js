import React from 'react'
import { seedProjects } from '../../testUtils/seedStore'
import store from '../../redux/store'

// seedProjects gives the first project this id.
const seededProject = { id: 'seeded-project-0', name: 'My Project' }

import UserTitle from '../../components/UserDetailedView/Header/UserTitle'

import renderer from 'react-test-renderer'

describe('UserTitle component', () => {
    describe('UserTitle snapshot test', () => {
        it('should render correctly', () => {
            const projects = [{ name: 'Build a Stairway To Heaven', id: '0', usersData: [{ role: 'role1' }] }]
            store.dispatch([...seedProjects(projects)])
            const tree = renderer
                .create(<UserTitle project={seededProject} contact={{ displayName: 'a b', id: 0 }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
