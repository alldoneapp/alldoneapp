/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import PendingTasksByDate from '../../../components/TaskListView/PendingTasksView/PendingTasksByDate'
import moment from 'moment'

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            loggedUserProjects: [{ id: '0' }],
            projectsUsers: { '0': [{ uid: 0, workflow: [] }] }
        })
    }),
    useDispatch: jest.fn()
}));

describe('PendingTasksByDate component', () => {
    it('should render correctly', async () => {
        const tree = renderer
            .create(
                <PendingTasksByDate date={moment()} projectId={'0'}
                    taskList={["1555192800000", {
                        '0': [{ userId: 0, stepHistory: [], userIds: [{}], recurrence: { type: 'never' } }],
                        '1': [{ userId: 0, stepHistory: [], userIds: [{}], recurrence: { type: 'never' } }]
                    }]}>
                </PendingTasksByDate>
            )
            .toJSON()
        expect(tree).toMatchSnapshot()
    })
})
