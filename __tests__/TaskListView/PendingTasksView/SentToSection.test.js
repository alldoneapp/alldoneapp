/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import SentToSection from '../../../components/TaskListView/PendingTasksView/SentToSection'


jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            loggedUserProjects: [{ id: '0' }],
            projectsUsers: {'0':[{ uid: 0, workflow: [] }]}
        })
    }),
    useDispatch: jest.fn()
}));

describe('SentToSection component', () => {
    it('should render correctly', () => {
        var element = React.createElement(SentToSection, {
            projectId: '0',
            tasks: [null, [{ userId: 0, stepHistory: [], userIds: [{}], recurrence: { type: 'never' } }]]
        })
        var json = renderer.create(element).toJSON()
        expect(json).toMatchSnapshot()
    })
})
