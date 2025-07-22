/**
 * @jest-environment jsdom
 */

import React from 'react'
import WorkflowPicker from '../../../components/TaskDetailedView/Properties/WorkflowPicker'
import store from '../../../redux/store'
import { storeCurrentUser } from '../../../redux/actions'

import renderer from 'react-test-renderer'

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

describe('WorkflowPicker component', () => {
    describe('WorkflowPicker snapshot test', () => {
        it('should render correctly', () => {
            store.dispatch(storeCurrentUser({workflow:[]}))
            const tree = renderer.create(<WorkflowPicker task={{ id: '0', done: false, inReview: false, toReview: 0 }}/>).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
