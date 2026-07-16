/**
 * @jest-environment jsdom
 */

import React from 'react'
import OpenTasksByProject from '../../../components/TaskListView/OpenTasksView/OpenTasksByProject'

import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            currentUser: {},
            loggedUserProjects: [{ id: '0' }],
            searchText: '',
            activeSearchForm: true,
        })
    }),
    useDispatch: jest.fn(),
}))

describe('OpenTasksByProject component', () => {
    it('should render correctly showing the EmptyInbox', () => {
        const tree = renderer
            .create(
                <OpenTasksByProject
                    todayTasks={[]}
                    overdueTasks={[]}
                    projectIndex={0}
                    receivedFrom={[]}
                    receivedFromOverdue={[]}
                    futureTasks={[]}
                />
            )
            .toJSON()
        expect(tree).toMatchSnapshot()
    })

    it('should render correctly hiding the EmptyInbox', () => {
        const tree = renderer
            .create(
                <OpenTasksByProject
                    todayTasks={[{ userIds: [], recurrence: { type: 'never' } }]}
                    overdueTasks={[]}
                    projectIndex={0}
                    receivedFrom={[]}
                    receivedFromOverdue={[]}
                    futureTasks={[]}
                />
            )
            .toJSON()
        expect(tree).toMatchSnapshot()
    })
})
