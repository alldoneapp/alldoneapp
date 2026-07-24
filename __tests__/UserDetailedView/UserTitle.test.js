import React from 'react'
import store from '../../redux/store'
import { storeLoggedUserProjects } from '../../redux/actions'
import UserTitle from '../../components/UserDetailedView/Header/UserTitle'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('UserTitle component', () => {
    describe('UserTitle snapshot test', () => {
        it('should render correctly', () => {
            const projects = [{ name: 'Build a Stairway To Heaven', id: '0', usersData: [{ role: 'role1' }] }]
            store.dispatch([storeLoggedUserProjects(projects)])
            const tree = renderer.create(<UserTitle projectIndex={0} contact={{ displayName: 'a b', id: 0 }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
