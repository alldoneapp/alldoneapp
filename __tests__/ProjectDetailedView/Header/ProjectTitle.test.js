/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectTitle from '../../../components/ProjectDetailedView/Header/ProjectTitle'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeLoggedUserProjects } from '../../../redux/actions'

describe('Detailed Project Title component', () => {
    describe('Detailed Project Title snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(storeLoggedUserProjects([{ name: 'My Project' }]))
            const tree = renderer.create(<ProjectTitle projectIndex={0} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
