import React from 'react'
import ProjectList from '../../components/SidebarMenu/ProjectList'
import store from '../../redux/store'
import { Provider } from 'react-redux'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }))

describe('ProjectList component', () => {
    describe('ProjectList snapshot test', () => {
        it('should render correctly', () => {
            const mockProjects = [
                {
                    index: 0,
                    id: '0',
                    color: '#FDCB6E',
                    name: 'NewOS',
                    inSideMenu: true,
                    tasks: [1],
                    userIds: [],
                },
                {
                    index: 1,
                    id: '1',
                    color: '#ADCB6E',
                    name: 'LizardFS',
                    inSideMenu: true,
                    tasks: [1, 2],
                    userIds: [],
                },
                {
                    index: 2,
                    id: '2',
                    color: '#BDCB6E',
                    name: 'Fame and Power',
                    inSideMenu: true,
                    tasks: [1, 2, 3],
                    userIds: [],
                },
            ]

            const tree = renderer
                .create(
                    <Provider store={store}>
                        <ProjectList projects={mockProjects} />
                    </Provider>
                )
                .toJSON()

            expect(tree).toMatchSnapshot()
        })
    })
})
