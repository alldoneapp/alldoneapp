import React from 'react'
import store from '../../redux/store'
import { storeLoggedUserProjects } from '../../redux/actions'
import Header from '../../components/UserDetailedView/Header/Header'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('Header component', () => {
    describe('Header snapshot test', () => {
        it('should render correctly', () => {
            const projects = [{ name: 'Build a Stairway To Heaven', id: '0' }]
            store.dispatch([storeLoggedUserProjects(projects)])
            const tree = renderer.create(<Header projectIndex={0} contact={{ photoURL: 'asd' }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
