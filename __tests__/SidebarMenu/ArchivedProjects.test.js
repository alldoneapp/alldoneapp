import React from 'react'
import ArchivedProjects from '../../components/SidebarMenu/ArchivedProjects'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('ArchivedProjects component', () => {
    describe('ArchivedProjects snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ArchivedProjects />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
