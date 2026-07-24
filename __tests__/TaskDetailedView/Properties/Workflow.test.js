/**
 * @jest-environment jsdom
 */

import React from 'react'
import Workflow from '../../../components/TaskDetailedView/Properties/Workflow'

import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { storeCurrentUser } from '../../../redux/actions'

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            currentUser: {},
            assignee: { workflow: {} }
        })
    }),
    useDispatch: jest.fn(),
    useStore: jest.fn().mockImplementation(() => {
        return {
            getState: () => {
                return { selectedProjectIndex: 0, projectsUsers: [[]] }
            }
        }
    })
}));


describe('Workflow component', () => {
    describe('Workflow snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(storeCurrentUser({ workflow: [] }))
            const tree = renderer.create(
                <Workflow projectId={0}
                    task={{ id: '0', done: false, inReview: false, toReview: 0 }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
