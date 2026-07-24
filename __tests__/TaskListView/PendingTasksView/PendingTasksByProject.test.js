/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import PendingTasksByProject from '../../../components/TaskListView/PendingTasksView/PendingTasksByProject'
import store from '../../../redux/store'
import { storeLoggedUserProjects } from '../../../redux/actions'

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            currentUser: {}
        })
    }),
    useDispatch: jest.fn(),
}));

describe('PendingTasksByProject component', () => {
    it('should render correctly', async () => {
        store.dispatch(storeLoggedUserProjects([{color: 'red'}]))
        const tree = renderer
            .create(
                <PendingTasksByProject pendingTasksObj={{}} projectIndex={0}>
                </PendingTasksByProject>
            )
            .toJSON()
        expect(tree).toMatchSnapshot()
    })
})
