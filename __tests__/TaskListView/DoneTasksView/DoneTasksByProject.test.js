/**
 * @jest-environment jsdom
 */

import React from 'react'
import DoneTasksByProject from '../../../components/TaskListView/DoneTasksView/DoneTasksByProject'

import renderer from 'react-test-renderer'
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

let loggedUserProjects = [
    { id: '-Asd', name: 'My project', color: '#0055ff' },
    { id: '-Asd2', name: 'My project 2', color: '#0055ff' },
]

describe('DoneTasksByProject component', () => {
    it('should render correctly', async () => {
        store.dispatch(storeLoggedUserProjects(loggedUserProjects))
        const tree = renderer.create(
            <DoneTasksByProject doneTasksObj={{}} projectIndex={0} />
        )
        expect(tree.toJSON()).toMatchSnapshot()
    })
})
