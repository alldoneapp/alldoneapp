/**
 * @jest-environment jsdom
 */

import React from 'react'
import { seedProjects } from '../../../testUtils/seedStore'
import ProjectTitle from '../../../components/ProjectDetailedView/Header/ProjectTitle'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'

// seedProjects gives the first project this id.
const seededProject = { id: 'seeded-project-0', name: 'My Project' }

describe('Detailed Project Title component', () => {
    describe('Detailed Project Title snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch([...seedProjects([{ name: 'My Project' }])])
            const tree = renderer.create(<ProjectTitle project={seededProject} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
