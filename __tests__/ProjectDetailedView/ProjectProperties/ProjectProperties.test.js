/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectProperties from '../../../components/ProjectDetailedView/ProjectProperties/ProjectProperties'
import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeLoggedUserProjects, storeLoggedUser, setProjectsUsers } from '../../../redux/actions'

describe('ProjectProperties component', () => {
    beforeEach(() => {
        store.dispatch([
            storeLoggedUserProjects([{ name: 'My Project', userIds: [] }]),
            storeLoggedUser({ displayName: 'Pepe', archivedProjectIds: [] }),
            setProjectsUsers([[{}]]),
        ])
    })

    describe('ProjectProperties snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ProjectProperties projectIndex={0} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
