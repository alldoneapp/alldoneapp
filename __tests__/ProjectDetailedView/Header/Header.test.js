/**
 * @jest-environment jsdom
 */

import React from 'react'
import Header from '../../../components/ProjectDetailedView/Header/Header'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeLoggedUserProjects } from '../../../redux/actions'

describe('Detailed Project Header component', () => {
    describe('Detailed Project Header snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(storeLoggedUserProjects([{ name: 'My Project' }]))
            const tree = renderer.create(<Header projectIndex={0} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
