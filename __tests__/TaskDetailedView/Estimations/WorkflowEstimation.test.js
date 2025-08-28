/**
 * @jest-environment jsdom
 */

import React from 'react'
import WorkflowEstimation from '../../../components/TaskDetailedView/Estimations/WorkflowEstimation'
import Backend from '../../../utils/BackendBridge'

import renderer from 'react-test-renderer'

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            selectedProjectUsers: [{ uid: 0 }],
            loggedUserProjects: [{ id: '1' }]
        })
    }),
}));

describe('WorkflowEstimation component', () => {
    it('should render correctly', () => {
        const tree = renderer.create(<WorkflowEstimation task={{ done: true, estimations: [] }} projectId={'1'} />).toJSON()
        expect(tree).toMatchSnapshot()
    })

    it('should call Backend.offOnUserWorkflowChange when it is unmounted', () => {
        // Given
        Backend.offOnUserWorkflowChange = jest.fn()
        const tree = renderer.create(<WorkflowEstimation task={{ done: true, estimations: [] }} projectId={'1'} />)
        // When
        tree.unmount()
        // Then
        expect(Backend.offOnUserWorkflowChange).toBeCalledTimes(1)
    })
})
