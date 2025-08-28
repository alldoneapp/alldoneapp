/**
 * @jest-environment jsdom
 */

import React from 'react'
import Header from '../../../components/ContactDetailedView/Header/Header'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeLoggedUserProjects, setProjectsContacts } from '../../../redux/actions'

describe('Detailed Project Header component', () => {
    describe('Detailed Project Header snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(
                setProjectsContacts({ 0: [] }),
                storeLoggedUserProjects([{ name: 'My Project' }])
            )
            const tree = renderer.create(<Header projectIndex={0} contact={{ role: '', photoURL: '' }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
